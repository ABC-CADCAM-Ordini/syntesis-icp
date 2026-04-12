#!/usr/bin/env python3
"""
Generatore di licenze per Syntesis-ICP.
Uso: python gen_licenses.py 25
"""

import sys
import asyncio
import uuid
import os

sys.path.insert(0, os.path.dirname(__file__))

def generate_key() -> str:
    """Genera chiave in formato SICP-XXXX-XXXX-XXXX."""
    parts = [uuid.uuid4().hex[:4].upper() for _ in range(3)]
    return f"SICP-{'-'.join(parts)}"


async def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    keys = [generate_key() for _ in range(n)]

    print(f"\n{'='*50}")
    print(f"  Syntesis-ICP — {n} nuove chiavi di licenza")
    print(f"{'='*50}\n")
    for k in keys:
        print(f"  {k}")
    print()

    # Inserisci nel DB se DATABASE_URL è impostato
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        from database import create_licenses, init_db
        await init_db()
        await create_licenses(keys)
        print(f"✓ Inserite nel database: {db_url}\n")
    else:
        print("⚠  DATABASE_URL non impostato — le chiavi NON sono state salvate nel DB.")
        print("   Esporta DATABASE_URL e riesegui oppure inseriscile manualmente.\n")

    # Salva su file
    out = "licenses_generated.txt"
    with open(out, "a") as f:
        for k in keys:
            f.write(k + "\n")
    print(f"✓ Salvate anche in: {out}\n")


if __name__ == "__main__":
    asyncio.run(main())
