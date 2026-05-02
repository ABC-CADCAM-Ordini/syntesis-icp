"""Syntesis-ICP - Registry delle costanti del dominio.

Fonte di verita' UNICA per:
- Costanti CAD dei tre tipi di scanbody (1T3, OS, SR)
- Soglie cliniche (d3, MUA cone, divergenza, fresabilita')
- Palette colori (cliniche, brand)
- Configurazioni globali (ambiente, miller, algoritmo)

Questo file viene letto da:
- icp_engine.py (calcoli ICP server-side)
- pdf_gen.py (rendering report)
- /api/registry/constants (esposto ai frontend al boot)

Convenzione T_root (Fase A audit layer condivisi, 2026-05-02):
    M = T * R
    "Prima ruoto il punto rispetto all'origine canonica, poi lo traslo."
    Implementata in build_T_root_matrix() qui sotto.

Nessun frontend dovrebbe avere costanti CAD hardcodate. Se le ha, sono debito
da rimuovere nelle Fasi A.5 e A.6 dell'audit. Single source of truth: questo file.
"""

import numpy as np

# ─────────────────────────────────────────────────────────────────────────────
# VERSION & METADATA
# ─────────────────────────────────────────────────────────────────────────────

# Versione del backend nel suo insieme. Bumpa ad ogni commit che tocca codice
# Python in backend/ (esclusi commit chore tipo CACHEBUST). Schema:
#     MAJOR.MINOR.BUILD-FASE.STEP   p.es. 8.1.5-A.4.1
# 8.x indica l'era post-v3b unificato (allineato alla serie Analizzare).
# Suffisso "-A.X" traccia la fase del refactor layer condivisi.
# Quando si promuove la Fase A in produzione, il suffisso sparisce -> 8.2.0.
#
# History:
#   8.1.6-A.5.0 (2026-05-02): aggiunte soglie angolari (angular_deg, angular_classes_it)
#   8.1.5-A.4.1 (2026-05-02): introduzione BACKEND_VERSION nel registry
#   8.1.4-A.4   (2026-05-02): pdf_gen.py legge palette brand dal registry
#   8.1.3-A.3   (2026-05-02): icp_engine.py legge max_tris dal registry
#   8.1.2-A.2   (2026-05-02): aggiunto backend/registry.py + endpoint
#   8.1.1-A.0   (2026-05-02): rimosso icp_engine_lab.py (copia 1:1)
#   8.1.0       (2026-05-02): stato pre-Fase A (Analizzare promosso ieri)
BACKEND_VERSION = "8.1.6-A.5.0"

REGISTRY_VERSION = "1.1.0"   # versione dello schema del registry (cambia se si aggiungono/rimuovono campi)
REGISTRY_SOURCE = "backend/registry.py"
LAST_UPDATED = "2026-05-02"

# ─────────────────────────────────────────────────────────────────────────────
# SCANBODY: geometrie CAD dei tre tipi di marker
# ─────────────────────────────────────────────────────────────────────────────
# Valori validati clinicamente con v8.1.0 (16 MUA reali, 2026-05-02).
# Ogni voce documenta il template CAD e i parametri di Sostituire (triade canonica).

SCANBODY = {
    "1T3": {
        "label": "1T3",
        "radius_mm": 2.515,           # raggio cap CAD (cilindro superiore)
        "cap_z_mm": 10,               # quota Z del disco superiore
        "bbox_xyz_mm": [5.03, 5.03, 1.90],
        "cap_area_ratio": 0.40,       # cap ~40% area totale del template
        "color_hex": 0xFFAA44,
        "flip_x_180": False,
        "sostituire": {
            "T_root": {
                "translation": [0, 0, -8.5],
            },
            # cull_cyl: TBD (estrarre da client al refactor A.5)
        },
    },
    "OS": {
        "label": "OS",
        "radius_mm": 1.78,
        "cap_z_mm": 6,
        "bbox_xyz_mm": [3.56, 5.56, 1.10],
        "cap_area_ratio": 0.03,       # cap ~3% area (piccolo e basso)
        "color_hex": 0x639922,
        "flip_x_180": False,
        "sostituire": {
            "T_root": {
                "translation": [0, 0, -10],
            },
        },
    },
    "SR": {
        "label": "SR",
        "radius_mm": 2.03,
        "cap_z_mm": 5,                # dopo flip 180 X (CAD nativo ha disco a Zmin=-5)
        "bbox_xyz_mm": [4.06, 4.06, 3.00],
        "cap_area_ratio": 0.06,
        "color_hex": 0x0052A3,
        "flip_x_180": True,           # CAD ha convenzione Z invertita, va flippato al parsing
        "sostituire": {
            "T_root": {
                "translation": [0, 0, -10],
                "rotation": {"axis": "X", "deg": 180},
            },
            "cull_cyl": {
                "z_min_mm": 2,
                "z_max_mm": 5,
                "margin_mm": 1.5,
            },
        },
    },
}

# searchR: raggio di ricerca cluster scanbody. Approssimativamente 1.7-2.0x
# il raggio CAD. Validato clinicamente in v8.1.0 (commit 3ca03dd, 16 MUA reali).
# Rapporti reali: 1T3=1.99x, OS=1.69x, SR=1.72x. Non uniforme: 1T3 ha tolleranza
# leggermente maggiore (probabilmente per la geometria piu' larga del cap).
SEARCH_R_MM = {
    "1T3": 5.0,
    "OS": 3.0,
    "SR": 3.5,
}

# ─────────────────────────────────────────────────────────────────────────────
# THRESHOLDS: soglie cliniche e tecniche
# ─────────────────────────────────────────────────────────────────────────────

THRESHOLDS = {
    # Soglie d3 (deviazione locale punto-superficie) in micrometri.
    # Ottimo < 50 < Accettabile < 100 < Rischioso < 150 < Tensione < 250 < Fuori posizione
    "d3_um": [50, 100, 150, 250],
    "d3_classes_it": [
        "Ottimo",
        "Accettabile",
        "Rischioso",
        "Tensione",
        "Fuori posizione",
    ],

    # Soglie angolari (deviazione asse) in gradi.
    # Riusano la palette d3 per coerenza visiva delle classi cliniche.
    "angular_deg": [0.5, 1.5, 3, 6],
    "angular_classes_it": [
        "Ottimo",
        "Accettabile",
        "Rischioso",
        "Tensione",
        "Fuori",
    ],

    # MUA: parametri geometrici del cono di accoppiamento.
    # Conservativi rispetto al datasheet IPD Standard Europeo (21° / 42°).
    "mua_cone_half_angle_deg": 20,
    "max_couple_divergence_deg": 40,

    # Fresabilita': solo 5-axis (4-axis non gestisce undercut MUA).
    "max_milling_angle_deg": 30,

    # OOM Railway: limite triangoli per scanbody nel ICP server-side.
    "max_tris_oom": 2500,
}

# ─────────────────────────────────────────────────────────────────────────────
# PALETTE: colori clinici e brand
# ─────────────────────────────────────────────────────────────────────────────

PALETTE = {
    # Classi d3 (5 colori, in ordine da Ottimo a Fuori posizione).
    "d3_hex": [
        "#639922",   # Ottimo (verde)
        "#D97706",   # Accettabile (ambra)
        "#F97316",   # Rischioso (arancio)
        "#EF4444",   # Tensione (rosso)
        "#A855F7",   # Fuori posizione (viola)
    ],
    # Brand (palette NASA-inspired: bianco, blu, scuro, grigio).
    "brand": {
        "blue": "#0052A3",
        "dark": "#0D1B2A",
        "gray": "#64748B",
    },
    "background": "#FFFFFF",
}

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG: configurazioni runtime
# ─────────────────────────────────────────────────────────────────────────────

CONFIG = {
    "env": {
        "background_hex": "#FFFFFF",
        "ambient_light": 0.4,
    },
    "miller": {
        "axes": 5,
        "max_angle_deg": 30,
    },
    "algorithm": {
        "mua_default": "client_v8.1.0",
        "allow_server_opt_in": True,
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def build_T_root_matrix(spec: dict) -> np.ndarray:
    """Compila un T_root strutturato in matrice 4x4 omogenea.

    Convenzione: M = T * R (prima ruoto rispetto all'origine, poi traslo).

    Args:
        spec: dizionario con almeno una di queste chiavi:
            - "translation": [tx, ty, tz]
            - "rotation": {"axis": "X"|"Y"|"Z", "deg": float}

    Returns:
        Matrice 4x4 numpy.float64.

    Examples:
        >>> build_T_root_matrix({"translation": [0, 0, -8.5]})
        # M_1T3: traslazione pura
        >>> build_T_root_matrix({
        ...     "translation": [0, 0, -10],
        ...     "rotation": {"axis": "X", "deg": 180}
        ... })
        # M_SR: ribaltamento + traslazione
    """
    M = np.eye(4, dtype=np.float64)

    rot = spec.get("rotation")
    if rot is not None:
        ax = rot["axis"].upper()
        rad = np.deg2rad(rot["deg"])
        c, s = np.cos(rad), np.sin(rad)
        if ax == "X":
            R = np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
        elif ax == "Y":
            R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
        elif ax == "Z":
            R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
        else:
            raise ValueError(f"Asse rotazione sconosciuto: {ax!r} (atteso X/Y/Z)")
        M[:3, :3] = R

    tr = spec.get("translation")
    if tr is not None:
        if len(tr) != 3:
            raise ValueError(f"translation deve avere 3 componenti, ricevuto {tr!r}")
        M[:3, 3] = tr

    return M


def get_scanbody(scanbody_id: str) -> dict:
    """Ritorna la voce SCANBODY per il tipo richiesto (1T3, OS, SR).

    Raises:
        KeyError: se scanbody_id non e' tra i tipi supportati.
    """
    if scanbody_id not in SCANBODY:
        raise KeyError(
            f"Scanbody {scanbody_id!r} non riconosciuto. "
            f"Supportati: {list(SCANBODY.keys())}"
        )
    return SCANBODY[scanbody_id]


def to_dict() -> dict:
    """Ritorna l'intero registry come dizionario JSON-serializzabile.

    Usato dall'endpoint /api/registry/constants per esporlo ai frontend.
    """
    return {
        "backend_version": BACKEND_VERSION,
        "version": REGISTRY_VERSION,
        "source": REGISTRY_SOURCE,
        "last_updated": LAST_UPDATED,
        "scanbody": SCANBODY,
        "search_r_mm": SEARCH_R_MM,
        "thresholds": THRESHOLDS,
        "palette": PALETTE,
        "config": CONFIG,
    }


# ─────────────────────────────────────────────────────────────────────────────
# SELF-TEST: invariate chiave
# ─────────────────────────────────────────────────────────────────────────────
# Questi check girano all'import del modulo e fanno fallire il deploy se le
# costanti diventano incoerenti. Cintura di sicurezza per refactor futuri.

def _self_test() -> None:
    # 1. searchR rapporto al raggio CAD entro un range plausibile.
    # Range allargato perche' il rapporto NON e' uniforme: 1T3=1.99x, OS=1.69x,
    # SR=1.72x. Vedi commento in cima a SEARCH_R_MM.
    for sb_id, expected_search in SEARCH_R_MM.items():
        radius = SCANBODY[sb_id]["radius_mm"]
        ratio = expected_search / radius
        assert 1.5 < ratio < 2.1, (
            f"searchR/radius fuori range per {sb_id}: ratio={ratio:.2f} (atteso 1.5-2.1)"
        )

    # 2. d3_classes ha esattamente d3_um + 1 elementi (n soglie -> n+1 classi)
    n_thr = len(THRESHOLDS["d3_um"])
    n_cls = len(THRESHOLDS["d3_classes_it"])
    assert n_cls == n_thr + 1, f"d3_classes={n_cls}, atteso d3_um+1={n_thr+1}"

    # 2b. angular_classes ha esattamente angular_deg + 1 elementi
    n_ang_thr = len(THRESHOLDS["angular_deg"])
    n_ang_cls = len(THRESHOLDS["angular_classes_it"])
    assert n_ang_cls == n_ang_thr + 1, (
        f"angular_classes={n_ang_cls}, atteso angular_deg+1={n_ang_thr+1}"
    )

    # 3. palette d3 ha lo stesso numero di colori delle classi
    assert len(PALETTE["d3_hex"]) == n_cls, (
        f"PALETTE.d3_hex={len(PALETTE['d3_hex'])} != d3_classes={n_cls}"
    )

    # 4. T_root SR ha rotazione X 180 (sanity check sulla flip convention)
    sr_rot = SCANBODY["SR"]["sostituire"]["T_root"].get("rotation")
    assert sr_rot is not None, "SR T_root deve avere rotation"
    assert sr_rot["axis"] == "X" and abs(sr_rot["deg"]) == 180, (
        f"SR rotation deve essere X 180, trovato {sr_rot}"
    )

    # 5. build_T_root_matrix produce matrici 4x4 valide
    for sb_id, sb in SCANBODY.items():
        spec = sb["sostituire"]["T_root"]
        M = build_T_root_matrix(spec)
        assert M.shape == (4, 4), f"T_root {sb_id}: shape {M.shape}"
        # ultima riga deve essere [0,0,0,1]
        assert np.allclose(M[3], [0, 0, 0, 1]), f"T_root {sb_id}: riga 3 non omogenea"
        # rotazione deve essere ortogonale (R @ R.T = I)
        R = M[:3, :3]
        assert np.allclose(R @ R.T, np.eye(3), atol=1e-9), (
            f"T_root {sb_id}: rotazione non ortogonale"
        )


_self_test()
