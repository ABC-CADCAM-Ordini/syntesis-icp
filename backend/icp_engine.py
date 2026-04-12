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
            {"name": "disco",       "min": 3200,  "max": 4700,  "role": "ring"},
            {"name": "corpo",       "min": 20000, "max": 32000, "role": "body"},
            {"name": "corpo_half",  "min": 12000, "max": 19999, "role": "body"},
        ]
    },
    {
        "name": "Generico", "color": "#888888",
        "parts": [
            {"name": "parte_a", "min": 200,  "max": 1249,  "role": "body"},
            {"name": "parte_b", "min": 1551, "max": 2127,  "role": "body"},
            {"name": "parte_c", "min": 5401, "max": 11999, "role": "body"},
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
    """
    Pre-allineamento robusto: prova rotazioni ogni 5° + hungarian matching.
    Gestisce qualsiasi sistema di riferimento relativo tra le due mesh.
    """
    from scipy.optimize import linear_sum_assignment as hungarian

    na, nb = len(ct_a), len(ct_b)
    if na == 0 or nb == 0:
        off = ct_a.mean(0) - ct_b.mean(0) if na > 0 and nb > 0 else np.zeros(3)
        return {"aligned": ct_b + off, "R": np.eye(3), "t": off, "method": "empty"}

    ca = ct_a.mean(axis=0)
    cb = ct_b.mean(axis=0)
    A_c = ct_a - ca
    B_c = ct_b - cb

    best_cost = float("inf")
    best_R = np.eye(3)
    best_t = ca - cb

    # Prova rotazioni nel piano XY ogni 5°
    for angle_deg in range(0, 360, 5):
        rad = np.radians(angle_deg)
        cos_a, sin_a = np.cos(rad), np.sin(rad)
        R_z = np.array([[cos_a, -sin_a, 0.0],
                        [sin_a,  cos_a, 0.0],
                        [0.0,    0.0,   1.0]])
        B_rot = (R_z @ B_c.T).T  # centroidi B ruotati

        n_match = min(na, nb)
        D = np.linalg.norm(A_c[:, None, :] - B_rot[None, :, :], axis=2)
        row, col = hungarian(D[:n_match, :n_match])
        cost = float(D[row, col].sum())

        if cost < best_cost:
            best_cost = cost
            # Raffina con Kabsch sui punti matchati
            A_matched = A_c[row]
            B_matched = B_rot[col]
            H = B_matched.T @ A_matched
            U, S, Vt = np.linalg.svd(H)
            R_kb = Vt.T @ U.T
            if np.linalg.det(R_kb) < 0:
                Vt[-1] *= -1
                R_kb = Vt.T @ U.T
            R_final = R_kb @ R_z
            t_final = ca - R_final @ cb
            best_R = R_final
            best_t = t_final

    aligned = (best_R @ ct_b.T).T + best_t
    return {"aligned": aligned, "R": best_R, "t": best_t, "method": "angle_search"}


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
def calc_score(pairs: list[dict], cyl_axes: list[dict]) -> float:
    """
    Identico a calcScore() in syntesis-icp v4 (index_4_.html):
    L6-norm pesata XY(55%) Z(30%) assi(15%) + iperbole 100/(1+(eff/110)^1.5)
    """
    valid = [p for p in pairs if p.get("d3") is not None]
    if not valid:
        return 0.0
    n = len(valid)

    # L6-norm deviazioni XY
    L6xy = (sum(abs(p["dxy"] * 1000) ** 6 for p in valid) / n) ** (1.0/6)

    # L6-norm deviazioni Z
    L6z  = (sum(abs(p["dz"]  * 1000) ** 6 for p in valid) / n) ** (1.0/6)

    # L6-norm angoli assi (1° ≈ 30 µm equivalente)
    ax_vals = [a["angle_deg"] for a in (cyl_axes or [])
               if a and a.get("angle_deg") is not None]
    if ax_vals:
        L6ax = (sum((a * 30) ** 6 for a in ax_vals) / len(ax_vals)) ** (1.0/6)
    else:
        L6ax = 0.0

    # Combinazione L2 pesata
    eff = math.sqrt(L6xy**2 * 0.55 + L6z**2 * 0.30 + L6ax**2 * 0.15)

    # Curva iperbole: inflection 110 µm, steepness 1.5
    score = 100.0 / (1.0 + (eff / 110.0) ** 1.5)

    return max(0.0, min(100.0, round(score * 100) / 100))
def score_label(score: float) -> dict:
    """Soglie identiche a scoreLabel() nel frontend v4."""
    if score >= 85:
        return {"label": "Eccellente", "col": "#639922", "bg": "#EAF3DE", "fg": "#3B6D11"}
    if score >= 70:
        return {"label": "Buono",      "col": "#D97706", "bg": "#FEFCE8", "fg": "#854D0E"}
    if score >= 50:
        return {"label": "Sufficiente","col": "#F97316", "bg": "#FFF3E0", "fg": "#9A3412"}
    if score >= 33:
        return {"label": "Scarso",     "col": "#EF4444", "bg": "#FEE2E2", "fg": "#991B1B"}
    return     {"label": "Critico",    "col": "#A855F7", "bg": "#F3E0F7", "fg": "#6B21A8"}


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
                     name_a: str = "A.stl", name_b: str = "B.stl",
                     landmarks: dict = None) -> dict:
    """
    Analisi ICP completa di due file STL.
    landmarks: {"a":[{x,y,z}x3], "b":[{x,y,z}x3]} per pre-allineamento manuale.
    Se fornito, bypassa il robust_pre_align automatico.
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

    # Auto-flip Z se le mesh sono specchiate (es. scanner intraorali con Z negativa)
    # Condizione: centroidi Z di segno opposto E distanza Z grande
    z_dist = abs(gc_a[2] - gc_b[2])
    z_same_sign = (gc_a[2] * gc_b[2]) > 0
    if not z_same_sign and z_dist > 5.0:
        # Flippa Z di tris_b per allinearla al sistema di riferimento di tris_a
        tris_b = tris_b.copy()
        tris_b[:, :, 2] *= -1
        gc_b = global_centroid(tris_b)
        raw_ct_b = np.array([centroid(tris_b, c) for c in scan_b])

    offset = gc_a - gc_b
    raw_ct_b_shifted = raw_ct_b + offset

    # Pre-allineamento: usa landmark manuali se forniti, altrimenti automatico
    if landmarks and len(landmarks.get("a", [])) >= 3 and len(landmarks.get("b", [])) >= 3:
        # Landmark-based pre-align: Kabsch su 3 punti corrispondenti
        pts_a_lm = np.array([[p["x"], p["y"], p["z"]] for p in landmarks["a"][:3]], dtype=np.float64)
        pts_b_lm = np.array([[p["x"], p["y"], p["z"]] for p in landmarks["b"][:3]], dtype=np.float64)
        # Kabsch diretto sui 3 landmark
        ca_lm = pts_a_lm.mean(0)
        cb_lm = pts_b_lm.mean(0)
        Ac_lm = pts_a_lm - ca_lm
        Bc_lm = pts_b_lm - cb_lm
        H_lm = Bc_lm.T @ Ac_lm
        U_lm, _, Vt_lm = np.linalg.svd(H_lm)
        R_lm = Vt_lm.T @ U_lm.T
        if np.linalg.det(R_lm) < 0:
            Vt_lm[-1] *= -1
            R_lm = Vt_lm.T @ U_lm.T
        t_lm = ca_lm - R_lm @ cb_lm
        aligned_lm = (R_lm @ raw_ct_b_shifted.T).T + t_lm
        pre = {"aligned": aligned_lm, "R": R_lm, "t": t_lm, "method": "landmark"}
        # Applica anche ai triangoli
        tris_b = apply_transform_tris(tris_b, R_lm, t_lm - R_lm @ offset + offset)
        raw_ct_b = np.array([centroid(tris_b, c) for c in scan_b])
        gc_b_new = global_centroid(tris_b)
        offset = gc_a - gc_b_new
        raw_ct_b_shifted = raw_ct_b + offset
        pre = robust_pre_align(raw_ct_a, raw_ct_b_shifted)
    else:
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
    # Costruisci mappa pi -> triangoli usando clust_a/b_sorted
    # (identico al JS: sortA[pi].map(idx => tA[idx]) e sortB[bestBi].map(idx => tBall[idx]))
    def cluster_tris_a(pi):
        """Triangoli del cilindro pi-esimo (ordinato come pairs)."""
        if pi >= len(clust_a_sorted):
            return np.empty((0, 3, 3), dtype=np.float32)
        idx_all = [ti for ci in clust_a_sorted[pi] for ti in scan_a[ci]]
        return tris_a[idx_all] if idx_all else np.empty((0, 3, 3), dtype=np.float32)

    def cluster_tris_b_all(pi):
        """Triangoli B trasformati del cilindro pi-esimo (ordinato come pairs)."""
        if pi >= len(clust_b_sorted):
            return np.empty((0, 3, 3), dtype=np.float32)
        idx_all = [ti for ci in clust_b_sorted[pi] for ti in scan_b[ci]]
        return tris_b_all[idx_all] if idx_all else np.empty((0, 3, 3), dtype=np.float32)

    cyl_axes = []
    for pi, pp in enumerate(pairs):
        tris_comp_a = cluster_tris_a(pi)
        if len(tris_comp_a) == 0:
            cyl_axes.append({"ax_a": None, "ax_b": None, "angle_deg": None})
            continue

        ax_a = cyl_axis(tris_comp_a)

        if pp["b"] is None:
            cyl_axes.append({"ax_a": ax_a.tolist(), "ax_b": None, "angle_deg": None})
            continue

        # Trova il cilindro B più vicino per centroide (come nel JS originale)
        b_pos = np.array(pp["b"])
        best_bi, best_d = -1, float("inf")
        for bi in range(len(clust_b_sorted)):
            idx_all_b = [ti for ci in clust_b_sorted[bi] for ti in scan_b[ci]]
            if not idx_all_b:
                continue
            bc_al = tris_b_all[idx_all_b].reshape(-1, 3).mean(axis=0)
            d = float(np.linalg.norm(b_pos - bc_al))
            if d < best_d:
                best_d, best_bi = d, bi

        if best_bi < 0:
            cyl_axes.append({"ax_a": ax_a.tolist(), "ax_b": None, "angle_deg": None})
            continue

        tris_comp_b = cluster_tris_b_all(best_bi)
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

    # Prepara triangoli mesh per anteprime (subsample se troppo grandi)
    def tris_to_list(t, max_tris=4000):
        arr = np.asarray(t)
        if len(arr) > max_tris:
            idx = np.linspace(0, len(arr)-1, max_tris, dtype=int)
            arr = arr[idx]
        return arr.tolist()

    # Background triangoli di A
    bg_tris_a = []
    for bi in bg_idx_a:
        bg_tris_a.extend(tris_a[comps_a[bi]].tolist())

    # Triangoli per cilindro A e B (per report)
    cyl_tris_a = []
    cyl_tris_b = []
    for pi in range(len(pairs)):
        ta = cluster_tris_a(pi)
        cyl_tris_a.append(tris_to_list(ta, 3500) if len(ta) > 0 else [])
        if pairs[pi].get("b") is not None:
            # Trova il cilindro B corrispondente (stesso metodo del cyl_axes)
            b_pos = np.array(pairs[pi]["b"])
            best_bi2, best_d2 = -1, float("inf")
            for bi2 in range(len(clust_b_sorted)):
                idx_all_b2 = [ti for ci in clust_b_sorted[bi2] for ti in scan_b[ci]]
                if not idx_all_b2:
                    continue
                bc_al2 = tris_b_all[idx_all_b2].reshape(-1, 3).mean(axis=0)
                d2 = float(np.linalg.norm(b_pos - bc_al2))
                if d2 < best_d2:
                    best_d2, best_bi2 = d2, bi2
            tb = cluster_tris_b_all(best_bi2) if best_bi2 >= 0 else np.empty((0,3,3))
            cyl_tris_b.append(tris_to_list(tb, 800) if len(tb) > 0 else [])
        else:
            cyl_tris_b.append([])

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
        # Dati mesh per anteprime e PDF
        "tris_a":    tris_to_list(tris_a, 6000),
        "tris_b_all": tris_to_list(tris_b_all, 6000),
        "bg_a":      tris_to_list(bg_tris_a, 2000) if bg_tris_a else [],
        "cyl_tris_a": cyl_tris_a,
        "cyl_tris_b": cyl_tris_b,
        "ct_a":      ct_a.tolist(),
        "ct_b_final": icp["aligned"].tolist(),
        "off":       offset.tolist(),
    }
