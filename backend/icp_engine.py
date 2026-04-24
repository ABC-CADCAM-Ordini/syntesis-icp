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
# Dtype strutturato per il formato binario STL: 50 byte a triangolo
# (12 normale + 36 vertici + 2 attr). np.frombuffer parsa tutto in
# una chiamata C invece di iterare in Python.
_STL_TRI_DTYPE = np.dtype([
    ('normal',   '<f4', 3),
    ('vertices', '<f4', (3, 3)),
    ('attr',     '<u2'),
])


def parse_stl(data: bytes) -> np.ndarray:
    """Restituisce array shape (N, 3, 3) — N triangoli, 3 vertici, 3 coord.

    Parser binario vettorializzato (np.frombuffer) con fallback ASCII.
    Su mesh di 100k triangoli il parser vettorializzato e` ~300x piu` veloce
    del loop Python e il risultato e` byte-per-byte identico.
    """
    if len(data) < 84:
        raise ValueError("File STL troppo corto.")

    n_tri = struct.unpack_from("<I", data, 80)[0]
    expected = 84 + n_tri * 50

    # Parser binario vettorializzato
    if expected == len(data) and n_tri > 0:
        arr = np.frombuffer(data, dtype=_STL_TRI_DTYPE, count=n_tri, offset=84)
        # np.array con copy=True forza memoria scrivibile e contigua:
        # frombuffer su bytes ritorna vista read-only, e l'ICP downstream
        # modifica gli array (traslazioni, rotazioni) in place.
        return np.array(arr['vertices'], dtype=np.float32, copy=True)

    # ASCII fallback (raramente usato: STL ASCII ha formato testuale
    # con 'facet normal' e 'vertex x y z', usato da alcuni CAD legacy)
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



def cap_centroid(tris: np.ndarray, indices: list[int]) -> np.ndarray:
    """Centroide delle sole facce orizzontali (cap superiore) del cilindro.
    Se non ci sono cap, ritorna il centroide normale."""
    t = tris[indices]
    # Calcola normali per triangolo
    v0, v1, v2 = t[:,0], t[:,1], t[:,2]
    e1, e2 = v1 - v0, v2 - v0
    nx = e1[:,1]*e2[:,2] - e1[:,2]*e2[:,1]
    ny = e1[:,2]*e2[:,0] - e1[:,0]*e2[:,2]
    nz = e1[:,0]*e2[:,1] - e1[:,1]*e2[:,0]
    nl = np.sqrt(nx**2 + ny**2 + nz**2).clip(1e-9)
    # Facce orizzontali: |nz/nl| > 0.5
    cap_mask = np.abs(nz / nl) > 0.5
    if cap_mask.sum() < 3:
        # Nessuna cap trovata -- usa centroide standard
        return t.reshape(-1, 3).mean(0)
    cap_tris = t[cap_mask]
    # Centroide delle cap (media dei centri dei triangoli)
    return cap_tris.mean(axis=1).mean(axis=0)

def get_cap_clusters(tris: np.ndarray, nm: np.ndarray, n_clusters: int = 6):
    """Trova N cluster di cap e restituisce (centroidi, normali).
    Usa solo i triangoli con |nz|>0.5 (facce orizzontali = dischi superiori).
    """
    nl = np.linalg.norm(nm, axis=1).clip(1e-9)
    cap_mask = np.abs(nm[:, 2] / nl) > 0.5
    if cap_mask.sum() < n_clusters * 3:
        cap_mask = np.ones(len(tris), dtype=bool)  # fallback

    cap_idx = np.where(cap_mask)[0]
    cap_cents = tris[cap_idx].mean(axis=1)  # centri dei triangoli cap

    from sklearn.cluster import KMeans
    km = KMeans(n_clusters, random_state=0, n_init=20, max_iter=500).fit(cap_cents)

    centroids = []
    normals = []
    cluster_idx = []
    for ci in range(n_clusters):
        mask_ci = km.labels_ == ci
        local_idx = cap_idx[mask_ci]
        tc = tris[local_idx]
        # Centroide della cap i = media dei centri dei triangoli
        cent = tc.mean(axis=1).mean(axis=0)
        # Normale media = direzione dell'asse del cilindro
        nxi = nm[local_idx, 0] / nl[local_idx]
        nyi = nm[local_idx, 1] / nl[local_idx]
        nzi = nm[local_idx, 2] / nl[local_idx]
        normal = np.array([nxi.mean(), nyi.mean(), nzi.mean()])
        nlen = np.linalg.norm(normal)
        normal = normal / nlen if nlen > 1e-9 else np.array([0.0, 0.0, 1.0])
        if normal[2] < 0:
            normal = -normal
        centroids.append(cent)
        normals.append(normal)
        cluster_idx.append(local_idx)
    return np.array(centroids), np.array(normals), cluster_idx


def local_deviation(cent_A: np.ndarray, normal_A: np.ndarray,
                    cent_B: np.ndarray) -> tuple:
    """Misura la deviazione di B rispetto ad A nel sistema locale di A.
    Origine = centroide cap A_i
    Z_locale = normale alla cap A_i (asse del cilindro)
    Ritorna (dXY, dZ, d3D) in mm.
    """
    delta = cent_B - cent_A
    # Proietta lungo l'asse del cilindro
    dz = float(np.dot(delta, normal_A))
    # Componente radiale (perpendicolare all'asse)
    delta_rad = delta - dz * normal_A
    dxy = float(np.linalg.norm(delta_rad))
    d3d = float(np.linalg.norm(delta))
    return dxy, dz, d3d


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


def partition_comps(comps: list[list[int]], tris: np.ndarray = None) -> tuple[list, list]:
    """Classifica le componenti in 'scanbody' e 'background'.

    Criterio v7.3.6 (additivo con veto leggero):
      - is_scan_sub(count): primo filtro count-based
      - _looks_like_scanbody_geometric: secondo filtro geometrico (piu` stringente)
      - veto leggero: se passa solo count-based (non geometric), e tris e`
        disponibile, richiede n_tri>=500 E max(bbox)<25mm. Scopo: scartare
        frammenti molto piccoli con conteggio fortuito e isole grandi tipo
        tessuti molli che non dovrebbero mai essere scanbody.
    Una componente e` scanbody se: (count E veto_ok) O geometric.
    
    IMPORTANTE: il veto NON richiede facce cap, perche` scanbody CAD spesso
    hanno corpo e cap come componenti topologiche separate (il corpo e` solo
    parete laterale senza cap, cap e` un disco piatto).
    """
    scan, bg = [], []
    for i, c in enumerate(comps):
        is_by_count = is_scan_sub(len(c))
        is_by_geom = (tris is not None) and _looks_like_scanbody_geometric(tris, c)
        
        # Veto leggero per count-based: filtra frammenti e macro-oggetti
        if is_by_count and not is_by_geom and tris is not None:
            if not _count_based_veto_ok(tris, c):
                is_by_count = False
        
        if is_by_count or is_by_geom:
            scan.append(i)
        else:
            bg.append(i)
    return scan, bg


def _count_based_veto_ok(tris: np.ndarray, comp: list[int]) -> bool:
    """Veto leggero per componenti accettate dal count-based:
      - almeno 500 triangoli (scarta rumore con count fortuito)
      - bbox max dimension < 25mm (scarta tessuti molli)
      - almeno 30 facce cap (|nz|>0.5): scarta scatole/coni vuoti senza disco
        riconoscibile (v7.3.7.002, fix Upper falsi positivi)
    
    Soglia 30 (non 100 come geometric strict) per non escludere CAD low-res
    in cui il cap e` rappresentato da pochi triangoli.
    """
    if len(comp) < 500:
        return False
    tc = tris[comp]
    bb = tc.reshape(-1, 3).max(0) - tc.reshape(-1, 3).min(0)
    if float(max(bb[0], bb[1], bb[2])) > 25.0:
        return False
    # v7.3.7.002: check minimo facce cap per filtrare scatole/coni vuoti.
    # Eccezione: CAD modellati con corpo cilindrico e cap come componenti
    # topologiche separate (es. 1T3.STL) hanno il corpo con n_cap=0.
    # Il corpo ha aspect ratio diametro/altezza > 2 (cilindro stretto/basso),
    # quindi lo riconosciamo e lo accettiamo anche con pochi cap.
    v0, v1, v2 = tc[:, 0], tc[:, 1], tc[:, 2]
    e1, e2 = v1 - v0, v2 - v0
    cross = np.cross(e1, e2)
    nl = np.linalg.norm(cross, axis=1).clip(1e-9)
    n_cap = int((np.abs(cross[:, 2] / nl) > 0.5).sum())
    aspect = max(float(bb[0]), float(bb[1])) / max(float(bb[2]), 0.01)
    is_flat_disc = (n_cap >= 100 and aspect > 5.0)  # disco piatto (es. cap CAD separato)
    is_cyl_body = (aspect > 2.0 and float(bb[2]) > 1.0)  # corpo cilindrico (es. body CAD)
    if n_cap < 30 and not is_flat_disc and not is_cyl_body:
        return False
    return True


def _looks_like_scanbody_geometric(tris: np.ndarray, comp: list[int]) -> bool:
    """Classifica una componente come scanbody sulla base della sua GEOMETRIA
    invece del conteggio triangoli. Criteri (v7.3.6):
      - bbox dimensioni planari: 3-12 mm per lato
      - bbox altezza:            0.5-12 mm
      - aspect ratio planare/Z:  0.3-3 (forma cilindrica o leggermente appiattita)
      - almeno 500 triangoli totali e 100 facce cap (|nz|>0.5)
    
    Questi criteri escludono: tessuti molli (bbox >> 12mm), frammenti (<500 tris),
    oggetti piatti (aspect ratio elevato), e includono scanbody a diverse
    risoluzioni di scanner.
    """
    n = len(comp)
    if n < 500:
        return False
    tc = tris[comp]
    verts = tc.reshape(-1, 3)
    bb_dim = verts.max(0) - verts.min(0)
    # Dimensioni attese per uno scanbody cilindrico
    planar_max = float(max(bb_dim[0], bb_dim[1]))
    planar_min = float(min(bb_dim[0], bb_dim[1]))
    height = float(bb_dim[2])
    if not (3.0 < planar_max < 12.0):
        return False
    if not (3.0 < planar_min < 12.0):
        return False
    if not (0.5 < height < 12.0):
        return False
    # Aspect ratio: diametro/altezza
    aspect = planar_max / max(height, 0.01)
    if not (0.3 < aspect < 3.0):
        return False
    # Almeno qualche faccia cap (|nz|>0.5)
    v0, v1, v2 = tc[:, 0], tc[:, 1], tc[:, 2]
    e1, e2 = v1 - v0, v2 - v0
    nz_c = e1[:, 0]*e2[:, 1] - e1[:, 1]*e2[:, 0]
    nl = np.sqrt(
        (e1[:, 1]*e2[:, 2] - e1[:, 2]*e2[:, 1])**2 +
        (e1[:, 2]*e2[:, 0] - e1[:, 0]*e2[:, 2])**2 +
        nz_c**2
    ).clip(1e-9)
    n_cap = int((np.abs(nz_c / nl) > 0.5).sum())
    if n_cap < 100:
        return False
    return True


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
    Pre-allineamento robusto con firma distanze + Kabsch 3D completo.
    1. Matching per firma distanze inter-centroide (invariante a roto-traslazione)
    2. Kabsch 3D su punti matchati -> rotazione 3D completa (pitch + roll + yaw)
    3. Refinamento ICP centroidi
    """
    from scipy.optimize import linear_sum_assignment as hungarian

    na, nb = len(ct_a), len(ct_b)
    if na == 0 or nb == 0:
        off = ct_a.mean(0) - ct_b.mean(0) if na > 0 and nb > 0 else np.zeros(3)
        return {"aligned": ct_b + off, "R": np.eye(3), "t": off, "method": "empty"}

    n = min(na, nb)
    A, B = ct_a[:n], ct_b[:n]

    # Con N<3 non si può fare Kabsch 3D -- solo traslazione centroide
    if n < 3:
        ca, cb = A.mean(0), B.mean(0)
        t = ca - cb
        aligned = ct_b + t
        return {"aligned": aligned, "R": np.eye(3), "t": t, "method": "centroid_only"}

    # ── 1. Matching per firma distanze (invariante a roto-traslazione) ────────
    def sig(pts, i):
        return np.sort([np.linalg.norm(pts[i]-pts[j]) for j in range(len(pts)) if j!=i])

    sig_A = np.array([sig(A, i) for i in range(n)])
    sig_B = np.array([sig(B, i) for i in range(n)])
    SIM = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            s = min(len(sig_A[i]), len(sig_B[j]))
            SIM[i,j] = np.sum((sig_A[i,:s] - sig_B[j,:s])**2)
    row, col = hungarian(SIM)

    A_matched = A[row]
    B_matched = B[col]

    # ── 2. Kabsch 3D completo sui punti matchati ──────────────────────────────
    def kabsch3d(A_m, B_m):
        ca, cb = A_m.mean(0), B_m.mean(0)
        Ac, Bc = A_m - ca, B_m - cb
        H = Bc.T @ Ac
        U, S, Vt = np.linalg.svd(H)
        R = Vt.T @ U.T
        if np.linalg.det(R) < 0:
            Vt[-1] *= -1
            R = Vt.T @ U.T
        t = ca - R @ cb
        return R, t

    R, t = kabsch3d(A_matched, B_matched)
    B_al = (R @ B.T).T + t

    # ── 3. Refinamento: re-match + re-Kabsch (3 iterazioni) ──────────────────
    for _ in range(3):
        D = np.linalg.norm(A[:,None] - B_al[None,:], axis=2)
        r2, c2 = hungarian(D)
        R2, t2 = kabsch3d(A[r2], B_al[c2])
        B_al = (R2 @ B_al.T).T + t2
        R = R2 @ R
        t = R2 @ t + t2

    # Calcola RMSD finale
    D_f = np.linalg.norm(A[:,None] - B_al[None,:], axis=2)
    rf, cf = hungarian(D_f)
    rmsd = float(np.sqrt(np.mean(D_f[rf,cf]**2)))

    # Applica la stessa trasformazione a ct_b completo
    aligned_full = (R @ ct_b.T).T + t

    return {"aligned": aligned_full, "R": R, "t": t,
            "method": "signature_kabsch3d", "rmsd_centroids": rmsd}


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

def parse_stl_with_normals(data: bytes):
    """Restituisce (tris, normals) shape (N,3,3) e (N,3)."""
    if len(data) < 84:
        raise ValueError("STL troppo corto.")
    n_tri = struct.unpack_from("<I", data, 80)[0]
    expected = 84 + n_tri * 50
    if expected == len(data) and n_tri > 0:
        raw = np.frombuffer(data, dtype="<f4",
                            count=n_tri * 12, offset=84).reshape(n_tri, 12)
        return raw[:, 3:12].reshape(n_tri, 3, 3).copy(), raw[:, :3].copy()
    tris, nms, cur = [], [], None
    for line in data.decode("utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line.startswith("facet normal"):
            p = line.split(); cur = {"n": [float(p[2]),float(p[3]),float(p[4])], "v": []}
        elif line.startswith("vertex") and cur:
            p = line.split(); cur["v"].append([float(p[1]),float(p[2]),float(p[3])])
        elif line.startswith("endfacet") and cur and len(cur["v"]) == 3:
            tris.append(cur["v"]); nms.append(cur["n"]); cur = None
    return np.array(tris, dtype=np.float32), np.array(nms, dtype=np.float32)


def icp_full_mesh(tris_a: np.ndarray, nm_a: np.ndarray,
                  tris_b: np.ndarray, nm_b: np.ndarray,
                  n_sample: int = 5000, max_iter: int = 80,
                  tol: float = 1e-8) -> dict:
    """ICP point-to-point su mesh subsampled (stratified: 40% cap + 60% resto).
    Usa scipy.spatial.cKDTree.

    Ritorna {R, t, rmsd, iter} (invariato), piu` metriche di qualita` (v7.3.6):
      - mask_ratio:    frazione di punti matchati nell'ultima iter
                       (coverage: 1.0 = tutti i sample hanno trovato match buoni)
      - residuals_std: std dei residui dei punti matchati (in mm)
      - normal_cos:    cos medio dell'angolo fra normali dei punti matchati
                       (1.0 = match geometricamente perfetto)
      - n_samples:     numero di sample complessivi usati
      - n_matched:     numero di sample matchati nell'ultima iter
    """
    from scipy.spatial import cKDTree as _KDT
    nl_a = np.linalg.norm(nm_a, axis=1).clip(1e-9)
    nl_b = np.linalg.norm(nm_b, axis=1).clip(1e-9)
    cap_a = np.abs(nm_a[:, 2] / nl_a) > 0.5
    cap_b = np.abs(nm_b[:, 2] / nl_b) > 0.5
    cents_a = tris_a.mean(1); cents_b = tris_b.mean(1)
    n_cap = min(int(n_sample * 0.4), int(cap_a.sum()), int(cap_b.sum()))
    n_rest = n_sample - n_cap
    rng = np.random.default_rng(42)
    idx_ca = rng.choice(np.where(cap_a)[0], n_cap, replace=False)
    idx_ra = rng.choice(np.where(~cap_a)[0], min(n_rest, int((~cap_a).sum())), replace=False)
    pts_a = np.vstack([cents_a[idx_ca], cents_a[idx_ra]])
    # Normali campionate di A (non vengono trasformate: sono fisse)
    nms_a = np.vstack([nm_a[idx_ca] / nl_a[idx_ca, None],
                       nm_a[idx_ra] / nl_a[idx_ra, None]])
    idx_cb = rng.choice(np.where(cap_b)[0], n_cap, replace=False)
    idx_rb = rng.choice(np.where(~cap_b)[0], min(n_rest, int((~cap_b).sum())), replace=False)
    pts_b = np.vstack([cents_b[idx_cb], cents_b[idx_rb]]).copy()
    # Normali campionate di B (vengono ruotate insieme a pts_b durante l'ICP)
    nms_b = np.vstack([nm_b[idx_cb] / nl_b[idx_cb, None],
                       nm_b[idx_rb] / nl_b[idx_rb, None]]).copy()
    R_acc = np.eye(3); t_acc = np.zeros(3)
    tree_a = _KDT(pts_a); prev_rmsd = float("inf")
    # Variabili tenute aggiornate per metriche finali
    last_dists = None; last_inds = None; last_mask = None
    for _it in range(max_iter):
        dists, inds = tree_a.query(pts_b, k=1)
        med = float(np.median(dists))
        mask = dists < med * 2.5
        if mask.sum() < 10: break
        last_dists, last_inds, last_mask = dists, inds, mask
        ma = pts_a[inds[mask]]; mb = pts_b[mask]
        ca, cb = ma.mean(0), mb.mean(0)
        H = (mb - cb).T @ (ma - ca)
        U, S, Vt = np.linalg.svd(H)
        R = Vt.T @ U.T
        if np.linalg.det(R) < 0: Vt[-1] *= -1; R = Vt.T @ U.T
        t = ca - R @ cb
        pts_b = (R @ pts_b.T).T + t
        nms_b = (R @ nms_b.T).T  # ruota anche le normali
        R_acc = R @ R_acc; t_acc = R @ t_acc + t
        rmsd = float(np.sqrt(np.mean(dists[mask] ** 2)))
        if abs(prev_rmsd - rmsd) < tol: break
        prev_rmsd = rmsd

    # ── Calcolo metriche di qualita` (v7.3.6) ──────────────────────────────
    n_samples_final = len(pts_b)
    if last_mask is not None and last_mask.sum() >= 3:
        n_matched = int(last_mask.sum())
        matched_dists = last_dists[last_mask]
        residuals_std = float(np.std(matched_dists))
        # Coerenza normali sui match
        nm_a_m = nms_a[last_inds[last_mask]]
        nm_b_m = nms_b[last_mask]
        cos_vals = np.sum(nm_a_m * nm_b_m, axis=1)
        # Le normali possono essere di segno opposto (convenzione scanner);
        # interessa l'allineamento del piano tangente → |cos|.
        normal_cos = float(np.mean(np.abs(cos_vals)))
    else:
        n_matched = 0
        residuals_std = 0.0
        normal_cos = 0.0

    mask_ratio = n_matched / max(1, n_samples_final)

    return {
        "R": R_acc, "t": t_acc,
        "rmsd": prev_rmsd, "iter": _it + 1,
        "mask_ratio": mask_ratio,
        "residuals_std": residuals_std,
        "normal_cos": normal_cos,
        "n_samples": n_samples_final,
        "n_matched": n_matched,
    }


def compute_confidence(coverage: float,
                        residual_mm: float,
                        uniformity_mm: float,
                        normal_cos: float,
                        scanner_sigma_um: float = 20.0) -> dict:
    """Combina le 4 metriche in un punteggio di confidenza 0-100.

    Parametri:
      coverage:      frazione di campioni matchati (0-1)
      residual_mm:   RMSD residuo dell'ICP in mm
      uniformity_mm: std dei residui in mm
      normal_cos:    cos medio dell'angolo tra normali matchate (0-1)
      scanner_sigma_um: rumore atteso dello scanner in micron (default 20)

    Ritorna un dict con score_pct (0-100), level ("alta"/"media"/"bassa"),
    i fattori originali e i fattori scalati a [0,1] per debug.

    Modello dei fattori (ognuno scalato a [0,1], poi media ponderata):
      f_coverage:  70% o piu` di copertura = 1.0, meno = proporzionale
      f_residual:  residuo <= sigma_scanner = 1.0, degrada per eccesso
      f_uniformity: std <= sigma_scanner = 1.0, degrada fino a 3*sigma
      f_normal:    0.7 → 0, 1.0 → 1.0 (lineare in mezzo)

    Pesi scelti in modo che coverage e normal_cos (indicatori che il motore
    stia guardando lo scanbody giusto) pesino piu` di residuo/uniformita`
    (che misurano qualita` ma non correttezza).
    """
    # Converti in micron per omogeneita`
    residual_um = residual_mm * 1000.0
    uniformity_um = uniformity_mm * 1000.0
    sigma = max(1.0, scanner_sigma_um)

    f_coverage = min(1.0, max(0.0, coverage / 0.7))
    # residuo sotto sigma: pieno punteggio. Oltre: degrada linearmente fino a 2*sigma = 0
    f_residual = max(0.0, min(1.0, 1.0 - max(0.0, residual_um - sigma) / sigma))
    # std: tollerata fino a 1*sigma al 100%, degrada fino a 3*sigma = 0
    f_uniformity = max(0.0, min(1.0, 1.0 - max(0.0, uniformity_um - sigma) / (2.0 * sigma)))
    # normal_cos: 0.7 → 0, 1.0 → 1.0
    f_normal = max(0.0, min(1.0, (normal_cos - 0.7) / 0.3)) if normal_cos > 0.7 else 0.0

    score_01 = 0.30 * f_coverage + 0.25 * f_residual + 0.20 * f_uniformity + 0.25 * f_normal
    score_pct = max(0.0, min(100.0, score_01 * 100.0))

    if score_pct >= 80.0:
        level = "alta"
    elif score_pct >= 55.0:
        level = "media"
    else:
        level = "bassa"

    return {
        "score_pct": round(score_pct, 1),
        "level": level,
        "factors": {
            "coverage": round(float(coverage), 3),
            "residual_um": round(residual_um, 1),
            "uniformity_um": round(uniformity_um, 1),
            "normal_cos": round(float(normal_cos), 3),
        },
        "scaled": {
            "f_coverage": round(f_coverage, 3),
            "f_residual": round(f_residual, 3),
            "f_uniformity": round(f_uniformity, 3),
            "f_normal": round(f_normal, 3),
        },
        "scanner_sigma_um": sigma,
    }


def _tri_normals(tris: np.ndarray) -> np.ndarray:
    """Normali unitarie per ogni triangolo (v7.3.6 helper)."""
    v0, v1, v2 = tris[:, 0], tris[:, 1], tris[:, 2]
    e1, e2 = v1 - v0, v2 - v0
    nx = e1[:, 1]*e2[:, 2] - e1[:, 2]*e2[:, 1]
    ny = e1[:, 2]*e2[:, 0] - e1[:, 0]*e2[:, 2]
    nz = e1[:, 0]*e2[:, 1] - e1[:, 1]*e2[:, 0]
    nl = np.sqrt(nx*nx + ny*ny + nz*nz).clip(1e-9)
    return np.stack([nx/nl, ny/nl, nz/nl], axis=1)


def compute_pair_confidence(tris_a_local: np.ndarray,
                              tris_b_local_aligned: np.ndarray,
                              scanner_sigma_um: float = 20.0,
                              match_threshold_um: float = 80.0) -> dict:
    """Calcola la confidenza di una singola coppia scanbody.
    
    tris_a_local:         triangoli del reference (scanbody CAD) nello spazio A
    tris_b_local_aligned: triangoli della scansione dello scanbody identificato,
                          gia` trasformati nello spazio di A
    scanner_sigma_um:     rumore atteso dello scanner (default 20 um)
    match_threshold_um:   soglia entro cui un punto e` considerato "matchato"
                          (default 80 um = 4*sigma, copre il 99.7% del rumore atteso)
    
    Ritorna il dict restituito da compute_confidence.
    """
    from scipy.spatial import cKDTree as _KDT
    
    if len(tris_a_local) < 20 or len(tris_b_local_aligned) < 20:
        return {
            "score_pct": None,
            "level": "non_disponibile",
            "note": f"mesh troppo piccole ({len(tris_a_local)} vs {len(tris_b_local_aligned)} tris)",
        }
    
    # Centroidi triangoli (punto rappresentativo per ognuno)
    cA = tris_a_local.mean(1)
    cB = tris_b_local_aligned.mean(1)
    nm_A = _tri_normals(tris_a_local)
    nm_B = _tri_normals(tris_b_local_aligned)
    
    # KDTree su A, query da B: per ogni punto di B trova il piu` vicino in A
    tree_a = _KDT(cA)
    dists, inds = tree_a.query(cB, k=1)
    
    # Coverage: frazione di punti di B che hanno un corrispondente entro la soglia
    threshold_mm = match_threshold_um / 1000.0
    matched = dists < threshold_mm
    coverage = float(matched.sum() / len(cB)) if len(cB) > 0 else 0.0
    
    if matched.sum() < 10:
        return {
            "score_pct": 0.0,
            "level": "bassa",
            "note": f"pochi match ({int(matched.sum())}) entro {match_threshold_um} um",
            "factors": {
                "coverage": round(coverage, 3),
                "residual_um": round(float(np.median(dists) * 1000), 1),
                "uniformity_um": round(float(np.std(dists) * 1000), 1),
                "normal_cos": 0.0,
            }
        }
    
    # RMSD residuo sui soli matched
    residual_mm = float(np.sqrt(np.mean(dists[matched]**2)))
    uniformity_mm = float(np.std(dists[matched]))
    
    # Coerenza normali sui matched
    nm_A_m = nm_A[inds[matched]]
    nm_B_m = nm_B[matched]
    cos_vals = np.sum(nm_A_m * nm_B_m, axis=1)
    normal_cos = float(np.mean(np.abs(cos_vals)))
    
    conf = compute_confidence(
        coverage=coverage,
        residual_mm=residual_mm,
        uniformity_mm=uniformity_mm,
        normal_cos=normal_cos,
        scanner_sigma_um=scanner_sigma_um,
    )
    conf["n_matched"] = int(matched.sum())
    conf["n_total"] = int(len(cB))
    return conf


def mean_cap_normal_z(tris: np.ndarray) -> float:
    """Restituisce la componente Z media delle normali delle facce cap (|nz|>0.5).
    Positivo = cap puntano verso +Z (orientamento corretto).
    Negativo = cap puntano verso -Z (file da flippare).
    """
    v0, v1, v2 = tris[:, 0], tris[:, 1], tris[:, 2]
    e1, e2 = v1 - v0, v2 - v0
    nz = e1[:, 0]*e2[:, 1] - e1[:, 1]*e2[:, 0]
    nl = np.sqrt((e1[:, 1]*e2[:, 2]-e1[:, 2]*e2[:, 1])**2 +
                 (e1[:, 2]*e2[:, 0]-e1[:, 0]*e2[:, 2])**2 +
                 nz**2).clip(1e-9)
    nz_norm = nz / nl
    cap_mask = np.abs(nz_norm) > 0.5
    if cap_mask.sum() < 3:
        return 1.0  # nessuna cap trovata → assume già corretto
    return float(nz_norm[cap_mask].mean())


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

    scan_idx_a, bg_idx_a = partition_comps(comps_a, tris_a)
    scan_idx_b, bg_idx_b = partition_comps(comps_b, tris_b)

    scan_a = [comps_a[i] for i in scan_idx_a]
    scan_b = [comps_b[i] for i in scan_idx_b]

    if not scan_a or not scan_b:
        # Fallback: usa tutti i componenti
        scan_a = comps_a
        scan_b = comps_b

    # Calcola centroidi delle cap (facce superiori) -- riferimento clinico consistente
    # tra scanner diversi: la cap è sempre alla stessa quota dell'impianto
    raw_ct_a = np.array([cap_centroid(tris_a, c) for c in scan_a])
    raw_ct_b = np.array([cap_centroid(tris_b, c) for c in scan_b])

    # Pre-allineamento globale
    gc_a = global_centroid(tris_a)
    gc_b = global_centroid(tris_b)

    # Auto-flip Z se le mesh sono specchiate (es. scanner intraorali con Z negativa)
    # Condizione: centroidi Z di segno opposto E distanza Z grande
    # ── Orientamento Z basato sulle normali delle cap ────────────────────────
    # Le normali delle cap puntano sempre verso il sensore (verso "sopra").
    # Normalizziamo entrambi i file in modo che le cap puntino verso +Z.
    # Questo è più robusto del segno del centroide Z.
    z_flipped = False
    nz_a = mean_cap_normal_z(tris_a[sum(scan_a, [])])
    nz_b = mean_cap_normal_z(tris_b[sum(scan_b, [])])

    # Flip A se le sue cap puntano in -Z
    if nz_a < 0:
        tris_a = tris_a.copy()
        tris_a[:, :, 2] *= -1
        raw_ct_a = np.array([cap_centroid(tris_a, c) for c in scan_a])
        gc_a = global_centroid(tris_a)

    # Flip B se le sue cap puntano in -Z
    if nz_b < 0:
        tris_b = tris_b.copy()
        tris_b[:, :, 2] *= -1
        gc_b = global_centroid(tris_b)
        raw_ct_b = np.array([cap_centroid(tris_b, c) for c in scan_b])
        z_flipped = True

    # Ricalcola centroidi dopo eventuali flip
    gc_a = global_centroid(tris_a)
    gc_b = global_centroid(tris_b)

    offset = gc_a - gc_b
    raw_ct_b_shifted = raw_ct_b + offset

    # ── Clustering preliminare: raggruppa parti dello stesso scanbody ──────────
    thresh_a_pre = auto_thresh(raw_ct_a)
    thresh_b_pre = auto_thresh(raw_ct_b_shifted)
    thresh_pre = min(thresh_a_pre, thresh_b_pre)

    clust_a_pre = cluster_comps(raw_ct_a, thresh_pre)
    clust_b_pre = cluster_comps(raw_ct_b_shifted, thresh_pre)

    na_orig, nb_orig = len(raw_ct_a), len(raw_ct_b_shifted)
    # Sanity check: se il clustering ha unito cilindri distinti
    # (thresh troppo grande), usa ogni componente come cluster separato.
    # Regola: se il numero di cluster < metà dei componenti originali,
    # il clustering è andato fuori controllo -- ripristina 1 cluster per comp.
    # Se ogni componente ha già una sola parte (es. cilindro intero),
    # il clustering non deve unire cilindri diversi.
    # Regola: se n_cluster < n_componenti E n_cluster non è circa n_comp/2
    # (che sarebbe il caso legittimo anello+corpo), usa 1 cluster per componente.
    # Caso legittimo: 12 componenti -> 6 cluster (ratio ~0.5) = anello+corpo
    # Caso sbagliato: 4 componenti  -> 2 cluster (ratio ~0.5) = ha unito cilindri
    # Distinzione: se ogni cluster ha >1 componente E la distanza intra-cluster
    # è < 8mm (distanza anello-corpo tipica), è legittimo. Altrimenti no.
    def _cluster_ok(clust, cents, max_intra_mm=8.0):
        for cl in clust:
            if len(cl) > 1:
                pts = cents[cl]
                d = float(np.linalg.norm(pts.max(0) - pts.min(0)))
                if d > max_intra_mm:
                    return False
        return True
    if not _cluster_ok(clust_a_pre, raw_ct_a):
        clust_a_pre = [[i] for i in range(na_orig)]
    if not _cluster_ok(clust_b_pre, raw_ct_b_shifted):
        clust_b_pre = [[i] for i in range(nb_orig)]

    ct_a_pre = np.array([raw_ct_a[[c for c in cl]].mean(0) for cl in clust_a_pre])
    ct_b_pre6 = np.array([raw_ct_b_shifted[[c for c in cl]].mean(0) for cl in clust_b_pre])

    # v7.3.6.003: rilevamento modalita` template-vs-patient.
    # Se A ha 1 solo cluster di riferimento (es. 1T3 singolo scanbody CAD in 2
    # isole topologiche unite dal clustering) e B ha piu` candidati, il motore
    # produce matematicamente un solo pair con d3 e rmsd prossimi a zero per
    # costruzione (sovrapposizione di 1 punto su 1 punto tramite Nelder-Mead).
    # Questo e` clinicamente non valutabile: il numero non riflette deviazioni
    # reali ma solo l`errore di coincidenza tra cap centers.
    is_template_mode = (len(ct_a_pre) == 1 and len(ct_b_pre6) > 1)

    # ── Pre-allineamento sui centroidi clusterizzati ──────────────────────────
    if landmarks and len(landmarks.get("a", [])) >= 3 and len(landmarks.get("b", [])) >= 3:
        pts_a_lm = np.array([[p["x"], p["y"], p["z"]] for p in landmarks["a"][:3]], dtype=np.float64)
        pts_b_lm = np.array([[p["x"], p["y"], p["z"]] for p in landmarks["b"][:3]], dtype=np.float64)
        # Applica le stesse trasformazioni usate su tris_b
        if z_flipped:
            pts_b_lm[:, 2] *= -1
        pts_b_lm = pts_b_lm + offset
        # Kabsch 3D nello stesso spazio di raw_ct_b_shifted
        ca_lm, cb_lm = pts_a_lm.mean(0), pts_b_lm.mean(0)
        H_lm = (pts_b_lm - cb_lm).T @ (pts_a_lm - ca_lm)
        U_lm, _, Vt_lm = np.linalg.svd(H_lm)
        R_pre = Vt_lm.T @ U_lm.T
        if np.linalg.det(R_pre) < 0:
            Vt_lm[-1] *= -1; R_pre = Vt_lm.T @ U_lm.T
        t_pre = ca_lm - R_pre @ cb_lm
        method_pre = "landmark"
    else:
        pa = robust_pre_align(ct_a_pre, ct_b_pre6)
        R_pre, t_pre = pa["R"], pa["t"]
        method_pre = pa.get("method", "auto")

    # Applica R_pre/t_pre a raw_ct_b_shifted e a tris_b
    raw_ct_b_aligned = (R_pre @ raw_ct_b_shifted.T).T + t_pre
    # Pre-allineamento centroidi → applica a tris_b
    tris_b_aligned = apply_transform_tris(tris_b + offset, R_pre, t_pre)

    # ── ICP sui soli scanbody (come Exocad ma robusto) ───────────────────────
    # Salta se landmarks manuali: l'utente ha già fornito la trasformazione.
    # Usa SOLO i triangoli degli scanbody evitando i tessuti molli che
    # differiscono tra scanner (causano minimi locali errati).
    if method_pre != "landmark":
        try:
            _scan_idx_a = [ti for comp in scan_a for ti in comp]
            _scan_idx_b = [ti for comp in scan_b for ti in comp]
            _tsa = tris_a[_scan_idx_a]
            _tsb = tris_b[_scan_idx_b]
            def _geom_nm(t):
                v0,v1,v2=t[:,0],t[:,1],t[:,2]
                e1,e2=v1-v0,v2-v0
                nx=e1[:,1]*e2[:,2]-e1[:,2]*e2[:,1]
                ny=e1[:,2]*e2[:,0]-e1[:,0]*e2[:,2]
                nz=e1[:,0]*e2[:,1]-e1[:,1]*e2[:,0]
                nl=np.sqrt(nx**2+ny**2+nz**2).clip(1e-9)
                return np.stack([nx/nl,ny/nl,nz/nl],axis=1)
            _nma = _geom_nm(_tsa)
            _nmb = _geom_nm(_tsb)
            _tsb_pre = apply_transform_tris(_tsb + offset, R_pre, t_pre)
            _nmb_pre = (R_pre @ _nmb.T).T
            _n = min(len(_tsa), len(_tsb_pre), 8000)
            _mesh = icp_full_mesh(_tsa, _nma, _tsb_pre, _nmb_pre,
                                  n_sample=_n, max_iter=100)
            R_mesh, t_mesh = _mesh["R"], _mesh["t"]
            # Accetta solo se migliora il RMSD sui centroidi cap
            _ct_a_chk = np.array([cap_centroid(tris_a, c) for c in scan_a])
            _ct_b_bef = (R_pre @ raw_ct_b_shifted.T).T + t_pre
            _ct_b_aft = (R_mesh @ _ct_b_bef.T).T + t_mesh
            D_bef = np.linalg.norm(_ct_a_chk[:,None]-_ct_b_bef[None,:], axis=2).min(axis=1).mean()
            D_aft = np.linalg.norm(_ct_a_chk[:,None]-_ct_b_aft[None,:], axis=2).min(axis=1).mean()
            if D_aft < D_bef * 1.05:
                R_pre = R_mesh @ R_pre
                t_pre = R_mesh @ t_pre + t_mesh
                tris_b_aligned = apply_transform_tris(tris_b_aligned, R_mesh, t_mesh)
        except Exception:
            pass

    # ── Clustering finale su B allineato + hungarian matching ────────────────
    thresh_b2 = auto_thresh(raw_ct_b_aligned)
    thresh2 = min(thresh_a_pre, thresh_b2)
    clust_a = cluster_comps(raw_ct_a, thresh2)
    clust_b = cluster_comps(raw_ct_b_aligned, thresh2)

    def _cluster_ok2(clust, cents, max_intra_mm=8.0):
        for cl in clust:
            if len(cl) > 1:
                pts = cents[cl]
                d = float(np.linalg.norm(pts.max(0) - pts.min(0)))
                if d > max_intra_mm:
                    return False
        return True
    if not _cluster_ok2(clust_a, raw_ct_a):
        clust_a = [[i] for i in range(na_orig)]
    if not _cluster_ok2(clust_b, raw_ct_b_aligned):
        clust_b = [[i] for i in range(nb_orig)]

    ct_a_cl = np.array([raw_ct_a[[c for c in cl]].mean(0) for cl in clust_a])
    ct_b_cl = np.array([raw_ct_b_aligned[[c for c in cl]].mean(0) for cl in clust_b])

    from scipy.optimize import linear_sum_assignment as hungarian
    n_cl = min(len(ct_a_cl), len(ct_b_cl))
    D_cl = np.linalg.norm(ct_a_cl[:n_cl, None] - ct_b_cl[None, :n_cl], axis=2)
    r_cl, c_cl = hungarian(D_cl)
    clust_a_sorted = [clust_a[i] for i in r_cl]
    clust_b_sorted = [clust_b[i] for i in c_cl]

    ct_a = np.array([raw_ct_a[[c for c in cl]].mean(0) for cl in clust_a_sorted])
    ct_b_raw = np.array([raw_ct_b_aligned[[c for c in cl]].mean(0) for cl in clust_b_sorted])

    # Override tris_b e offset per pipeline ICP
    tris_b = tris_b_aligned
    offset = np.zeros(3)  # già incluso in tris_b_aligned
    pre = {"R": R_pre, "t": t_pre, "method": method_pre}

    # ── Allineamento MINIMO: solo rotZ + traslazione 3D (no pitch/roll) ─────
    # Obiettivo: sovrapposizione minima senza distorcere con pitch/roll fittizi.
    from scipy.optimize import minimize as _min_opt
    def _cost_rzt(p):
        rz2,tx2,ty2,tz2 = p
        cz2,sz2 = math.cos(rz2), math.sin(rz2)
        Rz2 = np.array([[cz2,-sz2,0],[sz2,cz2,0],[0,0,1]])
        D2 = np.linalg.norm(ct_a[:,None] - ((Rz2 @ ct_b_raw.T).T + [tx2,ty2,tz2])[None,:], axis=2)
        from scipy.optimize import linear_sum_assignment as _h2
        _r,_c = _h2(D2)
        return float(np.sum(D2[_r,_c]**2))

    # Cerca il miglior angolo rz su 72 candidati (ogni 5 gradi)
    _best_cost, _best_rz = 1e18, 0.0
    _ca, _cb = ct_a.mean(0), ct_b_raw.mean(0)
    for _rz0 in np.linspace(0, 2*math.pi, 72, endpoint=False):
        _cz0, _sz0 = math.cos(_rz0), math.sin(_rz0)
        _Rz0 = np.array([[_cz0,-_sz0,0],[_sz0,_cz0,0],[0,0,1]])
        _t0 = _ca - _Rz0 @ _cb
        _c2 = _cost_rzt([_rz0, _t0[0], _t0[1], _t0[2]])
        if _c2 < _best_cost:
            _best_cost = _c2; _best_rz = _rz0

    # Affina con Nelder-Mead partendo dal miglior guess
    _cz0, _sz0 = math.cos(_best_rz), math.sin(_best_rz)
    _Rz0 = np.array([[_cz0,-_sz0,0],[_sz0,_cz0,0],[0,0,1]])
    _t0 = _ca - _Rz0 @ _cb
    _res = _min_opt(_cost_rzt, [_best_rz, _t0[0], _t0[1], _t0[2]],
                    method='Nelder-Mead',
                    options={'xatol':1e-8,'fatol':1e-8,'maxiter':100000})
    rz_min, tx_min, ty_min, tz_min = _res.x
    cz_m, sz_m = math.cos(rz_min), math.sin(rz_min)
    R_min = np.array([[cz_m,-sz_m,0],[sz_m,cz_m,0],[0,0,1]])
    t_min_v = np.array([tx_min, ty_min, tz_min])
    ct_b_aligned = (R_min @ ct_b_raw.T).T + t_min_v

    # Abbinamento finale hungarian
    from scipy.optimize import linear_sum_assignment as _hung
    D_final = np.linalg.norm(ct_a[:,None] - ct_b_aligned[None,:], axis=2)
    ra, ca_idx = _hung(D_final)

    # ── Misura LOCALE per ogni coppia (sistema di riferimento del cilindro A) ─
    # Per ogni coppia: dXY=deviazione radiale, dZ=deviazione assiale
    def _cap_axis(tris_comp):
        # Asse del cilindro: normale media delle facce orizzontali
        if len(tris_comp) == 0:
            return np.array([0,0,1], dtype=float)
        v0,v1,v2 = tris_comp[:,0], tris_comp[:,1], tris_comp[:,2]
        e1,e2 = v1-v0, v2-v0
        nx = e1[:,1]*e2[:,2]-e1[:,2]*e2[:,1]
        ny = e1[:,2]*e2[:,0]-e1[:,0]*e2[:,2]
        nz = e1[:,0]*e2[:,1]-e1[:,1]*e2[:,0]
        nl = np.sqrt(nx**2+ny**2+nz**2).clip(1e-9)
        cap_mask = np.abs(nz/nl) > 0.5
        if cap_mask.sum() < 3:
            return np.array([0,0,1], dtype=float)
        nxm,nym,nzm = nx[cap_mask].mean(), ny[cap_mask].mean(), nz[cap_mask].mean()
        ax = np.array([nxm,nym,nzm])
        ax /= np.linalg.norm(ax).clip(1e-9)
        if ax[2] < 0: ax = -ax
        return ax

    def _cap_center(tris_comp):
        # Centroide delle facce cap del cilindro
        if len(tris_comp) == 0:
            return np.zeros(3)
        v0,v1,v2 = tris_comp[:,0], tris_comp[:,1], tris_comp[:,2]
        e1,e2 = v1-v0, v2-v0
        nz_c = e1[:,0]*e2[:,1]-e1[:,1]*e2[:,0]
        nl_c = np.sqrt(((e1[:,1]*e2[:,2]-e1[:,2]*e2[:,1])**2 +
                       (e1[:,2]*e2[:,0]-e1[:,0]*e2[:,2])**2 + nz_c**2)).clip(1e-9)
        cap_mask = np.abs(nz_c/nl_c) > 0.5
        if cap_mask.sum() < 3:
            return tris_comp.reshape(-1,3).mean(0)
        return tris_comp[cap_mask].mean(axis=1).mean(axis=0)

    # Build pairs with LOCAL measurements
    import math as _math
    pairs = []
    for _ki in range(len(ra)):
        _ai, _bi = ra[_ki], ca_idx[_ki]
        # Triangoli del cilindro A_ai e B_bi (dopo trasformazione minima)
        _ta_idx = [ti for ci in clust_a_sorted[_ai] for ti in scan_a[ci]] if _ai < len(clust_a_sorted) else []
        _tb_idx = [ti for ci in clust_b_sorted[_bi] for ti in scan_b[ci]] if _bi < len(clust_b_sorted) else []
        _tris_a_i = tris_a[_ta_idx] if _ta_idx else np.empty((0,3,3),dtype=np.float32)
        # tris_b dopo R_min+t_min (allineamento minimo per avere le coord comparabili)
        _tris_b_i_raw = tris_b[_tb_idx] if _tb_idx else np.empty((0,3,3),dtype=np.float32)
        if len(_tris_b_i_raw) > 0:
            _tris_b_i = apply_transform_tris(_tris_b_i_raw, R_min, t_min_v)
        else:
            _tris_b_i = _tris_b_i_raw

        # Sistema locale del cilindro A_ai
        _O_a = _cap_center(_tris_a_i)
        _Z_local = _cap_axis(_tris_a_i)
        # Centro cap di B_bi nelle coordinate globali (dopo allineamento minimo)
        _O_b = _cap_center(_tris_b_i)
        # Vettore di spostamento nel sistema locale
        _d = _O_b - _O_a
        _dZ = float(np.dot(_d, _Z_local))
        _d_radiale = _d - _dZ * _Z_local
        _dXY = float(np.linalg.norm(_d_radiale))
        _d3 = float(np.linalg.norm(_d))

        pairs.append({
            "a": _O_a.tolist(), "b": _O_b.tolist(),
            "dx": float(_d_radiale[0]), "dy": float(_d_radiale[1]), "dz": _dZ,
            "dxy": _dXY, "d3": _d3,
        })

        # v7.3.6: confidenza per-coppia calcolata localmente su 6DOF alignment.
        # Uso tris_b_aligned (che e` tris_b post R_pre+t_pre, 6DOF completo)
        # invece di _tris_b_i (che e` tris_b post R_min+t_min_v, solo 3DOF Rz).
        # R_min raddrizza bene i centroidi cap ma non i triangoli tiltati.
        if _tb_idx and len(_tris_a_i) > 0:
            _tris_b_6dof = tris_b_aligned[_tb_idx]
            # Raggio locale: 99° percentile della distanza dei triangoli di A
            # dal loro centro cap, piu` un margine di 2mm. Piu` robusto di
            # max(bbox) che sottostima per scanbody bassi e larghi.
            _cA_all = _tris_a_i.mean(1)
            _dists_a = np.linalg.norm(_cA_all - _O_a, axis=1)
            _R_local = float(np.percentile(_dists_a, 99)) + 2.0
            _R_local = max(_R_local, 4.0)  # minimo 4mm comunque
            _cB = _tris_b_6dof.mean(1)
            _mask_local = np.linalg.norm(_cB - _O_a, axis=1) < _R_local
            _tris_b_local = _tris_b_6dof[_mask_local]
            _pair_conf = compute_pair_confidence(
                _tris_a_i, _tris_b_local,
                scanner_sigma_um=20.0,
                match_threshold_um=80.0,
            )
        else:
            _pair_conf = {
                "score_pct": None,
                "level": "non_disponibile",
                "note": "dati insufficienti per il calcolo della confidenza",
            }
        # Attacca la confidence all'ultima coppia appena creata
        if is_template_mode:
            # v7.3.6.003: override in modalita` template.
            # Il d3 matematicamente calcolato non rappresenta una deviazione
            # clinica reale quando A e` singolo reference e B ha N candidati.
            pairs[-1]["confidence"] = {
                "score_pct": None,
                "level": "non_disponibile",
                "note": ("modalita` template (A reference singolo vs B multi-scanbody): "
                         "d3 non utilizzabile come valutazione clinica. "
                         "Per misure affidabili fornire A e B con lo stesso numero di scanbody."),
            }
        else:
            pairs[-1]["confidence"] = _pair_conf

    # ICP sui centroidi per compatibilità (RMSD e angolo)
    icp = run_icp(ct_a, ct_b_aligned, max_iter=80)
    # Override tris_b_all con allineamento minimo (per visualizzazione corretta)
    _R_icp_min = R_min
    _t_icp_min = t_min_v


    # Trasforma tutte le mesh B
    # tris_b è già pre-allineato (R_pre+t_pre applicati sopra)
    # tris_b_all: allineamento minimo (rotZ+t) per visualizzazione senza distorsione
    tris_b_all = apply_transform_tris(tris_b, R_min, t_min_v)

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
    def tris_to_list(t, max_tris=2500):
        arr = np.asarray(t)
        if len(arr) == 0:
            return []
        if len(arr) <= max_tris:
            return arr.tolist()
        # Campionamento stratificato: max 800 cap + resto pareti
        v0, v1, v2 = arr[:, 0], arr[:, 1], arr[:, 2]
        e1, e2 = v1 - v0, v2 - v0
        nz = e1[:, 0]*e2[:, 1] - e1[:, 1]*e2[:, 0]
        nl = np.sqrt((e1[:, 1]*e2[:, 2]-e1[:, 2]*e2[:, 1])**2 +
                     (e1[:, 2]*e2[:, 0]-e1[:, 0]*e2[:, 2])**2 +
                     nz**2).clip(1e-9)
        cap_m = np.abs(nz / nl) > 0.5
        cap_idx  = np.where(cap_m)[0]
        wall_idx = np.where(~cap_m)[0]
        # Cap: max 800 triangoli
        n_cap = min(len(cap_idx), 800)
        if len(cap_idx) > n_cap:
            cap_sel = cap_idx[np.linspace(0, len(cap_idx)-1, n_cap, dtype=int)]
        else:
            cap_sel = cap_idx
        n_wall = max_tris - n_cap
        if len(wall_idx) > n_wall:
            wall_sel = wall_idx[np.linspace(0, len(wall_idx)-1, n_wall, dtype=int)]
        else:
            wall_sel = wall_idx
        sel = np.concatenate([cap_sel, wall_sel])
        return arr[sel].tolist()

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
            cyl_tris_b.append(tris_to_list(tb, 3500) if len(tb) > 0 else [])
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
        "analysis_mode": "template" if is_template_mode else "pairwise",
        "excluded_a": len(bg_idx_a),
        "excluded_b": len(bg_idx_b),
        # v7.3.6: numero di scanbody trovati in B ma non matchati al reference
        # (tipicamente quando |A| < |B|, cioe` un reference singolo vs scansione
        # con multi-scanbody). 0 nel caso normale |A|==|B|.
        "extra_instances_b": max(0, len(scan_b) - len(pairs)),
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


# ═══════════════════════════════════════════════════════════════════════════════
# SOSTITUIRE: allineamento template → marker rilevato
# ═══════════════════════════════════════════════════════════════════════════════

def _rotation_between_vectors(v_from: np.ndarray, v_to: np.ndarray) -> np.ndarray:
    """Matrice di rotazione che porta v_from su v_to (entrambi unitari)."""
    a = v_from / (np.linalg.norm(v_from) + 1e-12)
    b = v_to / (np.linalg.norm(v_to) + 1e-12)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    s = float(np.linalg.norm(v))
    if s < 1e-9:
        # Vettori paralleli o antiparalleli
        if c > 0:
            return np.eye(3)
        # Antiparalleli: rotazione di 180° attorno ad un asse perpendicolare ad a
        # Scelgo l'asse canonico meno allineato con a
        ax = np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 1.0, 0])
        perp = np.cross(a, ax)
        perp /= np.linalg.norm(perp)
        # Rodrigues con theta=pi
        K = np.array([[0, -perp[2], perp[1]],
                      [perp[2], 0, -perp[0]],
                      [-perp[1], perp[0], 0]])
        return np.eye(3) + 2.0 * K @ K
    # Rodrigues
    K = np.array([[0, -v[2], v[1]],
                  [v[2], 0, -v[0]],
                  [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * ((1 - c) / (s * s))


def _cap_centroid_for_cluster(pts: np.ndarray, axis: np.ndarray, top: bool = True) -> np.ndarray:
    """Centroide della cap (sup o inf) di un cluster di punti, proiettati sull'asse."""
    c = pts.mean(axis=0)
    proj = (pts - c) @ axis
    pmax, pmin = proj.max(), proj.min()
    H = pmax - pmin
    thresh = max(H * 0.20, 0.1)
    if top:
        cap_mask = proj > pmax - thresh
    else:
        cap_mask = proj < pmin + thresh
    cap_pts = pts[cap_mask]
    if len(cap_pts) < 3:
        return c
    return cap_pts.mean(axis=0)


def align_template_to_marker(template_tris: np.ndarray,
                             marker_pts: np.ndarray,
                             use_icp: bool = True,
                             n_rot_attempts: int = 16) -> dict:
    """
    Allinea un template (mesh STL parsata) ad un cluster di punti di un marker
    rilevato nella scansione Multi-A.

    Pipeline:
      1. Asse template + asse marker (cyl_axis-style via PCA + cap normals)
      2. Rotazione minima per allineare gli assi
      3. Traslazione per centroide cap top (template top ↔ marker top)
      4. Se use_icp: 16 rotazioni attorno all'asse + ICP point-to-point
         scegliendo il miglior risultato per RMSD

    Input:
      template_tris: ndarray shape (N, 3, 3)   triangoli del template
      marker_pts:    ndarray shape (M, 3)      punti del cluster marker
      use_icp:       bool                      se applicare refine ICP
      n_rot_attempts: int                      rotazioni di spin (16 = 22.5° step)

    Output:
      dict con:
        R: matrice di rotazione 3x3
        t: vettore di traslazione 3
        rmsd: RMSD finale
        method: descrizione pipeline usata
    """
    # ── Validazione input ────────────────────────────────────────────────────
    if len(template_tris) < 10:
        raise ValueError(f"Template troppo piccolo: {len(template_tris)} triangoli")
    if len(marker_pts) < 30:
        raise ValueError(f"Marker cluster troppo piccolo: {len(marker_pts)} punti")

    # ── 1. Assi e centroidi ──────────────────────────────────────────────────
    tpl_pts = template_tris.reshape(-1, 3)
    tpl_axis = cyl_axis(template_tris)
    marker_axis = cyl_axis(marker_pts.reshape(-1, 1, 3).repeat(3, axis=1))  # trucco: riusa cyl_axis

    # Entrambi gli assi puntano da cap bottom a cap top (per convenzione cyl_axis)
    tpl_top = _cap_centroid_for_cluster(tpl_pts, tpl_axis, top=True)
    marker_top = _cap_centroid_for_cluster(marker_pts, marker_axis, top=True)

    # ── 2. Rotazione iniziale per allineare assi ─────────────────────────────
    R_axis = _rotation_between_vectors(tpl_axis, marker_axis)

    # ── 3. Traslazione cap-top a cap-top ─────────────────────────────────────
    tpl_pts_rot = apply_transform(tpl_pts, R_axis, np.zeros(3))
    tpl_top_rot = R_axis @ tpl_top
    t_init = marker_top - tpl_top_rot

    tpl_aligned = tpl_pts_rot + t_init
    R_best = R_axis
    t_best = t_init

    if not use_icp:
        # Calcolo solo RMSD di nearest neighbor per reporting
        # (sub-sample per velocità)
        moving_sub = tpl_aligned[::max(1, len(tpl_aligned) // 1000)]
        dists = np.linalg.norm(marker_pts[:, None, :] - moving_sub[None, :, :], axis=2)
        rmsd = float(np.sqrt(np.mean(dists.min(axis=0) ** 2)))
        return {
            "R": R_best.tolist(),
            "t": t_best.tolist(),
            "rmsd": rmsd,
            "method": "rigid_axis_align"
        }

    # ── 4. ICP con spin attempts attorno all'asse del marker ─────────────────
    # Per ogni rotazione di spin, runno ICP breve e tengo il migliore
    best_rmsd = float("inf")
    best_R = R_best
    best_t = t_best

    # Sub-sample template per ICP veloce (cap max ~500 punti)
    if len(tpl_aligned) > 500:
        stride = len(tpl_aligned) // 500
        tpl_ds = tpl_aligned[::stride]
    else:
        tpl_ds = tpl_aligned

    for k in range(n_rot_attempts):
        theta = (2 * np.pi * k) / n_rot_attempts
        # Rotazione di theta attorno a marker_axis, applicata intorno a marker_top
        axis_u = marker_axis / np.linalg.norm(marker_axis)
        c_t, s_t = np.cos(theta), np.sin(theta)
        K = np.array([[0, -axis_u[2], axis_u[1]],
                      [axis_u[2], 0, -axis_u[0]],
                      [-axis_u[1], axis_u[0], 0]])
        R_spin = np.eye(3) * c_t + s_t * K + (1 - c_t) * np.outer(axis_u, axis_u)
        # spin attorno a marker_top: P' = R_spin @ (P - marker_top) + marker_top
        moving = (R_spin @ (tpl_ds - marker_top).T).T + marker_top
        icp_res = run_icp(marker_pts, moving, max_iter=30)
        rmsd_k = icp_res["rmsd"]
        if rmsd_k < best_rmsd:
            best_rmsd = rmsd_k
            # Trasformazione composta: R_spin (attorno a marker_top) + R_axis + t_init + R_icp + t_icp
            # Applico la composizione:
            #   P_out = R_icp @ (R_spin @ (R_axis @ P + t_init - marker_top) + marker_top) + t_icp
            # Espando:
            #   R_final = R_icp @ R_spin @ R_axis
            #   t_final = R_icp @ (R_spin @ (t_init - marker_top) + marker_top) + t_icp
            R_icp = np.asarray(icp_res["R"])
            t_icp = np.asarray(icp_res["t"])
            R_final = R_icp @ R_spin @ R_axis
            t_final = R_icp @ (R_spin @ (t_init - marker_top) + marker_top) + t_icp
            best_R = R_final
            best_t = t_final

    return {
        "R": best_R.tolist(),
        "t": best_t.tolist(),
        "rmsd": best_rmsd,
        "method": f"icp_spin_{n_rot_attempts}"
    }
