"""
Syntesis-ICP — Motore di analisi (Python/NumPy)
Copyright (C) Francesco Biaggini. Tutti i diritti riservati.

Questo modulo contiene l'algoritmo proprietario ICP.
Gira SOLO sul server — non viene mai inviato al client.
"""

import struct
import math
import numpy as np
from typing import Optional


# ── Scanbody profiles ─────────────────────────────────────────────────────────
SCANBODY_PROFILES = [
    {
        "name": "ScanLogiQ", "color": "#1D9E75",
        "parts": [
            {"name": "anello", "min": 450,   "max": 650,   "role": "ring"},
            {"name": "corpo",  "min": 1250,  "max": 1550,  "role": "body"},
        ]
    },
    {
        "name": "IPD ProCam", "color": "#378ADD",
        "parts": [
            {"name": "disco", "min": 2128, "max": 3547, "role": "ring"},
            {"name": "corpo", "min": 3240, "max": 5400, "role": "body"},
        ]
    },
    {
        "name": "Shining", "color": "#EF9F27",
        "parts": [
            {"name": "disco", "min": 3200,  "max": 4700,  "role": "ring"},
            {"name": "corpo", "min": 20000, "max": 30000, "role": "body"},
        ]
    },
]

CLIN_LEVELS = [
    {"max": 50,   "label": "Ottimo",          "col": "#639922"},
    {"max": 100,  "label": "Accettabile",      "col": "#D97706"},
    {"max": 150,  "label": "Rischioso",        "col": "#F97316"},
    {"max": 250,  "label": "Tensione",         "col": "#EF4444"},
    {"max": 99999,"label": "Fuori posizione",  "col": "#A855F7"},
]

CLIN_AXIS = [
    {"max": 0.5,  "label": "Ottimo"},
    {"max": 1.5,  "label": "Accettabile"},
    {"max": 3.0,  "label": "Rischioso"},
    {"max": 6.0,  "label": "Tensione"},
    {"max": 9999, "label": "Fuori posizione"},
]


def clin_level(d3_um: float) -> dict:
    for lv in CLIN_LEVELS:
        if d3_um < lv["max"]:
            return lv
    return CLIN_LEVELS[-1]


def clin_axis(deg: float) -> dict:
    for lv in CLIN_AXIS:
        if deg < lv["max"]:
            return lv
    return CLIN_AXIS[-1]


# ── STL parsing ───────────────────────────────────────────────────────────────
def parse_stl(data: bytes) -> np.ndarray:
    """Restituisce array shape (N, 3, 3) — N triangoli, 3 vertici, 3 coord."""
    if len(data) < 84:
        raise ValueError("File STL troppo corto.")

    n_tri = struct.unpack_from("<I", data, 80)[0]
    expected = 84 + n_tri * 50

    # Prova binary
    if expected == len(data) and n_tri > 0:
        tris = np.zeros((n_tri, 3, 3), dtype=np.float32)
        offset = 84
        for i in range(n_tri):
            for v in range(3):
                x, y, z = struct.unpack_from("<fff", data, offset + 12 + v * 12)
                tris[i, v] = [x, y, z]
            offset += 50
        return tris

    # ASCII fallback
    import re
    text = data.decode("utf-8", errors="ignore")
    nums = re.findall(r"vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)", text)
    if not nums:
        raise ValueError("Nessun vertice trovato nel file STL.")
    verts = np.array([[float(x), float(y), float(z)] for x, y, z in nums], dtype=np.float32)
    if len(verts) % 3 != 0:
        raise ValueError("Numero di vertici non multiplo di 3.")
    return verts.reshape(-1, 3, 3)


# ── Connected components via union-find ──────────────────────────────────────
def find_components(tris: np.ndarray) -> list[list[int]]:
    """Raggruppa triangoli per vertici condivisi. Ritorna lista di liste di indici."""
    n = len(tris)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # Raggruppa per vertice arrotondato a 3 decimali
    vertex_map: dict[tuple, list[int]] = {}
    for i, tri in enumerate(tris):
        for v in tri:
            key = (round(float(v[0]), 3), round(float(v[1]), 3), round(float(v[2]), 3))
            vertex_map.setdefault(key, []).append(i)

    for indices in vertex_map.values():
        for j in range(1, len(indices)):
            union(indices[0], indices[j])

    groups: dict[int, list[int]] = {}
    for i in range(n):
        r = find(i)
        groups.setdefault(r, []).append(i)

    return [g for g in groups.values() if len(g) >= 4]


def centroid(tris: np.ndarray, indices: list[int]) -> np.ndarray:
    pts = tris[indices].reshape(-1, 3)
    return pts.mean(axis=0)


def global_centroid(tris: np.ndarray) -> np.ndarray:
    return tris.reshape(-1, 3).mean(axis=0)


# ── Scanbody detection ────────────────────────────────────────────────────────
def is_scan_sub(count: int) -> bool:
    for prof in SCANBODY_PROFILES:
        for part in prof["parts"]:
            if part["min"] <= count <= part["max"]:
                return True
    return False


def detect_profile(count: int) -> Optional[dict]:
    for prof in SCANBODY_PROFILES:
        for part in prof["parts"]:
            if part["min"] <= count <= part["max"]:
                return {"profile": prof, "part": part}
    return None


def dominant_profile(comps: list[list[int]]) -> Optional[dict]:
    votes: dict[str, int] = {}
    for c in comps:
        d = detect_profile(len(c))
        if d:
            k = d["profile"]["name"]
            votes[k] = votes.get(k, 0) + 1
    if not votes:
        return None
    best = max(votes, key=lambda k: votes[k])
    for prof in SCANBODY_PROFILES:
        if prof["name"] == best:
            return prof
    return None


def partition_comps(comps: list[list[int]]) -> tuple[list, list]:
    scan, bg = [], []
    for i, c in enumerate(comps):
        (scan if is_scan_sub(len(c)) else bg).append(i)
    return scan, bg


# ── 3×3 linear algebra ────────────────────────────────────────────────────────
def kabsch(A: np.ndarray, B: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Kabsch: trova R, t tale che R @ A_i + t ≈ B_i."""
    cA = A.mean(axis=0)
    cB = B.mean(axis=0)
    Ac = A - cA
    Bc = B - cB
    H = Ac.T @ Bc
    U, _, Vt = np.linalg.svd(H)
    d = np.linalg.det(Vt.T @ U.T)
    D = np.diag([1, 1, d])
    R = Vt.T @ D @ U.T
    t = cB - R @ cA
    return R, t


def apply_transform(pts: np.ndarray, R: np.ndarray, t: np.ndarray) -> np.ndarray:
    return (R @ pts.T).T + t


def apply_transform_tris(tris: np.ndarray, R: np.ndarray, t: np.ndarray) -> np.ndarray:
    orig = tris.shape
    pts = tris.reshape(-1, 3)
    return apply_transform(pts, R, t).reshape(orig)


# ── Distance signature pre-alignment ─────────────────────────────────────────
def dist_sig(pts: np.ndarray, i: int) -> np.ndarray:
    d = np.linalg.norm(pts - pts[i], axis=1)
    d = np.delete(d, i)
    return np.sort(d)


def sig_diff(sa: np.ndarray, sb: np.ndarray) -> float:
    n = min(len(sa), len(sb))
    if n == 0:
        return float("inf")
    return float(np.sum((sa[:n] - sb[:n]) ** 2) / n)


def robust_pre_align(ct_a: np.ndarray, ct_b: np.ndarray) -> dict:
    na, nb = len(ct_a), len(ct_b)
    sigs_a = [dist_sig(ct_a, i) for i in range(na)]
    sigs_b = [dist_sig(ct_b, i) for i in range(nb)]

    corr = []
    for i in range(na):
        best_j = min(range(nb), key=lambda j: sig_diff(sigs_a[i], sigs_b[j]))
        corr.append(best_j)

    # Verifica biiezione
    if len(set(corr)) == na:
        b_matched = ct_b[corr]
        R, t = kabsch(b_matched, ct_a)
        aligned = apply_transform(ct_b, R, t)
        return {"aligned": aligned, "R": R, "t": t, "method": "signature"}

    # Fallback: traslazione centroidi
    off = ct_a.mean(axis=0) - ct_b.mean(axis=0)
    return {"aligned": ct_b + off, "R": np.eye(3), "t": off, "method": "centroid"}


# ── ICP ───────────────────────────────────────────────────────────────────────
def run_icp(fixed: np.ndarray, moving: np.ndarray, max_iter: int = 80) -> dict:
    """ICP point-to-point con Kabsch. Ritorna R_acc, t_acc, aligned, rmsd, angle."""
    Bt = moving.copy()
    R_acc = np.eye(3)
    t_acc = np.zeros(3)
    prev_rmsd = float("inf")

    for _ in range(max_iter):
        # Nearest neighbor (brute-force OK per N ≤ ~100 centroidi)
        dists = np.linalg.norm(fixed[:, None] - Bt[None, :], axis=2)  # (nF, nB)
        idx = dists.argmin(axis=0)  # per ogni B trova il più vicino in A
        matched_f = fixed[idx]

        R, t = kabsch(Bt, matched_f)
        Bt = apply_transform(Bt, R, t)
        R_acc = R @ R_acc
        t_acc = R @ t_acc + t

        rmsd = float(np.sqrt(np.mean(np.sum((Bt - matched_f) ** 2, axis=1))))
        if abs(prev_rmsd - rmsd) < 1e-9:
            break
        prev_rmsd = rmsd

    trace = np.trace(R_acc)
    angle_deg = float(np.degrees(np.arccos(np.clip((trace - 1) / 2, -1, 1))))
    return {"R": R_acc, "t": t_acc, "aligned": Bt, "rmsd": prev_rmsd, "angle": angle_deg}


# ── Cylinder axis ─────────────────────────────────────────────────────────────
def cyl_axis(tris: np.ndarray) -> np.ndarray:
    """Face-normal method per l'asse del cilindro."""
    if len(tris) < 3:
        return np.array([0., 0., 1.])

    pts = tris.reshape(-1, 3)
    n = len(pts)
    if n < 9:
        return np.array([0., 0., 1.])

    c = pts.mean(axis=0)
    ptsc = pts - c
    cov = (ptsc.T @ ptsc) / n
    vals, vecs = np.linalg.eigh(cov)
    ord_idx = np.argsort(vals)[::-1]
    ev0, ev1 = vals[ord_idx[0]], vals[ord_idx[1]]
    ax_idx = ord_idx[2] if (ev0 > 0 and ev1 / ev0 > 0.6) else ord_idx[0]
    ax_pca = vecs[:, ax_idx]

    proj = ptsc @ ax_pca
    pmin, pmax = proj.min(), proj.max()
    H = pmax - pmin
    thresh = H * 0.18
    cap_top = ptsc[proj > pmax - thresh]
    cap_bot = ptsc[proj < pmin + thresh]

    def cap_normal(cap):
        if len(cap) < 6:
            return None
        cc = cap.mean(axis=0)
        cv = ((cap - cc).T @ (cap - cc)) / len(cap)
        lv, lvecs = np.linalg.eigh(cv)
        return lvecs[:, np.argmin(lv)]

    n_top = cap_normal(cap_top)
    n_bot = cap_normal(cap_bot)
    if n_top is None and n_bot is None:
        return ax_pca
    if n_top is None:
        n_top = n_bot
    if n_bot is None:
        n_bot = n_top

    if np.dot(n_top, ax_pca) < 0:
        n_top = -n_top
    if np.dot(n_bot, ax_pca) < 0:
        n_bot = -n_bot

    ax = n_top + n_bot
    norm = np.linalg.norm(ax)
    return ax / norm if norm > 1e-10 else ax_pca


def axis_angle_deg(a: np.ndarray, b: np.ndarray) -> float:
    dot = abs(np.dot(a, b))
    return float(np.degrees(np.arccos(np.clip(dot, -1, 1))))


# ── Match pairs ───────────────────────────────────────────────────────────────
def match_pairs(ct_a: np.ndarray, ct_b: np.ndarray) -> list[dict]:
    used = set()
    pairs = []
    for a in ct_a:
        best_i, best_d = -1, float("inf")
        for i, b in enumerate(ct_b):
            if i in used:
                continue
            d = float(np.linalg.norm(a - b))
            if d < best_d:
                best_d, best_i = d, i
        if best_i >= 0:
            used.add(best_i)
            b = ct_b[best_i]
            dx, dy, dz = float(b[0]-a[0]), float(b[1]-a[1]), float(b[2]-a[2])
            d3 = math.sqrt(dx**2 + dy**2 + dz**2)
            pairs.append({
                "a": a.tolist(), "b": b.tolist(),
                "dx": dx, "dy": dy, "dz": dz,
                "dxy": math.sqrt(dx**2+dy**2),
                "d3": d3
            })
        else:
            pairs.append({"a": a.tolist(), "b": None,
                          "dx": None, "dy": None, "dz": None, "dxy": None, "d3": None})
    return pairs


# ── Score ─────────────────────────────────────────────────────────────────────
def calc_score(pairs: list[dict], cyl_axes: list[dict]) -> int:
    valid = [p for p in pairs if p["d3"] is not None]
    if not valid:
        return 0

    d3_um = [p["d3"] * 1000 for p in valid]
    rmsd_um = math.sqrt(sum(d**2 for d in d3_um) / len(d3_um))

    ax_degs = [a["angle_deg"] for a in cyl_axes if a.get("angle_deg") is not None]
    max_ax = max(ax_degs) if ax_degs else 0.0

    # Score da RMSD (0-70 punti)
    if rmsd_um < 30:
        score_d = 70
    elif rmsd_um < 80:
        score_d = int(70 - (rmsd_um - 30) / 50 * 30)
    elif rmsd_um < 200:
        score_d = int(40 - (rmsd_um - 80) / 120 * 30)
    else:
        score_d = max(0, int(10 - (rmsd_um - 200) / 100 * 10))

    # Score da asse (0-30 punti)
    if max_ax < 0.5:
        score_ax = 30
    elif max_ax < 1.5:
        score_ax = int(30 - (max_ax - 0.5) * 15)
    elif max_ax < 3.0:
        score_ax = int(15 - (max_ax - 1.5) * 7)
    else:
        score_ax = max(0, int(5 - (max_ax - 3.0) * 2))

    return min(100, score_d + score_ax)


def score_label(score: int) -> dict:
    if score >= 90:
        return {"label": "Eccellente", "col": "#0D9E6E"}
    if score >= 75:
        return {"label": "Ottimo",     "col": "#639922"}
    if score >= 55:
        return {"label": "Accettabile","col": "#D97706"}
    if score >= 35:
        return {"label": "Rischioso",  "col": "#F97316"}
    return {"label": "Critico",    "col": "#DC2626"}


# ── Clustering ────────────────────────────────────────────────────────────────
def auto_thresh(cents: np.ndarray) -> float:
    if len(cents) <= 1:
        return 999.0
    nn = []
    for i, c in enumerate(cents):
        dists = np.linalg.norm(cents - c, axis=1)
        dists[i] = np.inf
        nn.append(dists.min())
    nn.sort()
    best_ratio, best_t = 1.0, nn[-1] * 2
    for i in range(1, len(nn)):
        ratio = nn[i] / (nn[i-1] or 0.001)
        if ratio > best_ratio:
            best_ratio = ratio
            best_t = (nn[i-1] + nn[i]) / 2
    if best_ratio < 1.5:
        best_t = nn[-1] * 2
    spread = float(np.linalg.norm(cents.max(axis=0) - cents.min(axis=0)))
    result = min(best_t, spread * 0.25)
    return max(result, nn[0] * 1.1)


def cluster_comps(cents: np.ndarray, thresh: float) -> list[list[int]]:
    n = len(cents)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(n):
        for j in range(i+1, n):
            if np.linalg.norm(cents[i] - cents[j]) <= thresh * 1.02:
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[ri] = rj

    groups: dict[int, list[int]] = {}
    for i in range(n):
        r = find(i)
        groups.setdefault(r, []).append(i)
    return list(groups.values())


# ── Main entry point ──────────────────────────────────────────────────────────
def analyze_stl_pair(data_a: bytes, data_b: bytes,
                     name_a: str = "A.stl", name_b: str = "B.stl") -> dict:
    """
    Analisi ICP completa di due file STL.
    Restituisce dizionario con tutti i risultati.
    """
    tris_a = parse_stl(data_a)
    tris_b = parse_stl(data_b)

    comps_a = find_components(tris_a)
    comps_b = find_components(tris_b)

    if not comps_a or not comps_b:
        raise ValueError("Nessun componente trovato in uno o entrambi i file STL.")

    scan_idx_a, bg_idx_a = partition_comps(comps_a)
    scan_idx_b, bg_idx_b = partition_comps(comps_b)

    scan_a = [comps_a[i] for i in scan_idx_a]
    scan_b = [comps_b[i] for i in scan_idx_b]

    if not scan_a or not scan_b:
        # Fallback: usa tutti i componenti
        scan_a = comps_a
        scan_b = comps_b

    # Calcola centroidi grezzi
    raw_ct_a = np.array([centroid(tris_a, c) for c in scan_a])
    raw_ct_b = np.array([centroid(tris_b, c) for c in scan_b])

    # Pre-allineamento globale
    gc_a = global_centroid(tris_a)
    gc_b = global_centroid(tris_b)
    offset = gc_a - gc_b
    raw_ct_b_shifted = raw_ct_b + offset

    pre = robust_pre_align(raw_ct_a, raw_ct_b_shifted)
    ct_b_pre = pre["aligned"]

    # Clustering
    thresh_a = auto_thresh(raw_ct_a)
    thresh_b = auto_thresh(raw_ct_b)
    thresh = min(thresh_a, thresh_b)

    clust_a = cluster_comps(raw_ct_a, thresh)
    clust_b = cluster_comps(ct_b_pre, thresh)

    # Merge clusters → centroidi finali per ICP
    def merged_cent(tris, comps_list, cluster):
        idx_all = [i for ci in cluster for i in comps_list[ci]]
        return centroid(tris, idx_all)

    sort_key_a = lambda cl: tuple(raw_ct_a[[c for c in cl]].mean(axis=0)[:2])
    sort_key_b = lambda cl: tuple(ct_b_pre[[c for c in cl]].mean(axis=0)[:2])

    clust_a_sorted = sorted(clust_a, key=sort_key_a)
    clust_b_sorted = sorted(clust_b, key=sort_key_b)

    ct_a = np.array([raw_ct_a[cl].mean(axis=0) for cl in clust_a_sorted])
    ct_b_raw = np.array([ct_b_pre[cl].mean(axis=0) for cl in clust_b_sorted])

    # ICP
    icp = run_icp(ct_a, ct_b_raw, max_iter=80)
    pairs = match_pairs(ct_a, icp["aligned"])

    # Trasforma tutte le mesh B
    tris_b_offset = tris_b + offset
    if not np.allclose(pre["R"], np.eye(3)):
        tris_b_pre = apply_transform_tris(tris_b_offset, pre["R"], pre["t"])
    else:
        tris_b_pre = tris_b_offset
    tris_b_all = apply_transform_tris(tris_b_pre, icp["R"], icp["t"])

    # Assi cilindri
    cyl_axes = []
    for pi, pp in enumerate(pairs):
        if pi >= len(scan_a):
            cyl_axes.append({"ax_a": None, "ax_b": None, "angle_deg": None})
            continue

        tris_comp_a = tris_a[scan_a[pi]] if pi < len(scan_a) else None
        if tris_comp_a is None or len(tris_comp_a) == 0:
            cyl_axes.append({"ax_a": None, "ax_b": None, "angle_deg": None})
            continue

        ax_a = cyl_axis(tris_comp_a)

        if pp["b"] is None:
            cyl_axes.append({"ax_a": ax_a.tolist(), "ax_b": None, "angle_deg": None})
            continue

        # Trova il componente B più vicino
        b_pos = np.array(pp["b"])
        best_bi, best_d = -1, float("inf")
        for bi, bc in enumerate(scan_b):
            bc_pos = centroid(tris_b, bc) + offset
            if not np.allclose(pre["R"], np.eye(3)):
                bc_pos = pre["R"] @ bc_pos + pre["t"]
            bc_al = icp["R"] @ bc_pos + icp["t"]
            d = float(np.linalg.norm(b_pos - bc_al))
            if d < best_d:
                best_d, best_bi = d, bi

        if best_bi < 0:
            cyl_axes.append({"ax_a": ax_a.tolist(), "ax_b": None, "angle_deg": None})
            continue

        tris_comp_b = tris_b_all[scan_b[best_bi]]
        ax_b = cyl_axis(tris_comp_b)
        ax_b_canon = icp["R"].T @ ax_b
        ang = axis_angle_deg(ax_a, ax_b_canon)
        cyl_axes.append({
            "ax_a": ax_a.tolist(),
            "ax_b": ax_b.tolist(),
            "angle_deg": ang
        })

    # Score
    score = calc_score(pairs, cyl_axes)
    sl = score_label(score)

    detected = dominant_profile(scan_a + scan_b)

    return {
        "score": score,
        "score_label": sl["label"],
        "score_col": sl["col"],
        "icp_rmsd": float(icp["rmsd"]),
        "icp_angle": float(icp["angle"]),
        "pairs": pairs,
        "cyl_axes": cyl_axes,
        "detected_profile": detected["name"] if detected else "Generico",
        "n_scan_a": len(scan_a),
        "n_scan_b": len(scan_b),
        "excluded_a": len(bg_idx_a),
        "excluded_b": len(bg_idx_b),
        "filename_a": name_a,
        "filename_b": name_b,
    }
