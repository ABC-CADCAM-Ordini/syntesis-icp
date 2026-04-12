# Syntesis-ICP — Webapp

## Struttura del progetto

```
syntesis-icp-webapp/
├── backend/
│   ├── main.py          ← FastAPI app
│   ├── auth.py          ← Login / registrazione / JWT
│   ├── icp_engine.py    ← MOTORE ICP PROPRIETARIO (gira solo sul server)
│   ├── database.py      ← PostgreSQL (asyncpg)
│   ├── pdf_gen.py       ← Generatore PDF firmato
│   ├── gen_licenses.py  ← Script per creare chiavi licenza
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   └── index.html       ← UI (nessun codice ICP qui!)
├── nginx/
│   └── default.conf
├── docker-compose.yml
├── railway.toml
└── .env.example
```

---

## Deploy su Railway (senza esperienza server)

### 1. Carica il codice su GitHub
Crea un repository GitHub, carica tutti i file. NON committare .env

### 2. Crea progetto Railway
- Vai su railway.app → "New Project → Deploy from GitHub repo"
- Scegli il repo

### 3. Aggiungi PostgreSQL
Nel pannello Railway: "+ New" → "Database" → "Add PostgreSQL"

### 4. Imposta le variabili d'ambiente
Nel pannello "Variables":

    JWT_SECRET=<genera: python -c "import secrets; print(secrets.token_hex(32))">
    ALLOWED_ORIGINS=https://tuodominio.it
    RATE_LIMIT_PER_HOUR=60

DATABASE_URL viene aggiunta automaticamente da Railway.

### 5. Collega il dominio di Register.it
In Railway → "Settings → Custom Domain" → inserisci il tuo dominio
In Register.it → DNS → aggiungi CNAME verso il dominio Railway

### 6. Genera licenze
    railway run python gen_licenses.py 25

---

## Sicurezza

| Elemento | Protezione |
|----------|-----------|
| Algoritmo ICP | Gira ONLY sul server |
| Accesso | JWT obbligatorio |
| Licenze | 1 licenza = 1 utente, revocabile |
| Rate limit | 60 analisi/ora per utente |
| PDF | Firmato server-side |
| HTTPS | Automatico su Railway |

---

Copyright (C) Francesco Biaggini — Biaggini Medical Devices S.r.l.
