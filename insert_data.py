import os
from pathlib import Path
import psycopg2
from psycopg2.extras import execute_values
import pandas as pd
import time

BASE_DIR = Path(__file__).resolve().parent
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required")

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

start_time = time.time()

print("🚀 Starting Data Import...")

# -------------------------------
# STEP 1: Insert Country
# -------------------------------
cur.execute("""
INSERT INTO country (name, code)
VALUES ('India', 'IND')
ON CONFLICT (code) DO NOTHING;
""")
conn.commit()

cur.execute("SELECT id FROM country WHERE code = 'IND'")
country_id = cur.fetchone()[0]

print("✅ Country Ready")

# -------------------------------
# Load Data
# -------------------------------
states_df = pd.read_csv(BASE_DIR / "entities" / "states.csv")
districts_df = pd.read_csv(BASE_DIR / "entities" / "districts.csv")
subdistricts_df = pd.read_csv(BASE_DIR / "entities" / "subdistricts.csv")
villages_df = pd.read_csv(BASE_DIR / "entities" / "villages.csv")

print(f"States: {len(states_df)}")
print(f"Districts: {len(districts_df)}")
print(f"SubDistricts: {len(subdistricts_df)}")
print(f"Villages: {len(villages_df)}")

# -------------------------------
# STEP 2: Insert States
# -------------------------------
state_map = {}

for i, row in states_df.iterrows():
    try:
        cur.execute("""
        INSERT INTO state (code, name, country_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (code) DO NOTHING
        RETURNING id;
        """, (row["code"], row["name"], country_id))

        result = cur.fetchone()

        if result:
            state_map[row["code"]] = result[0]
        else:
            cur.execute("SELECT id FROM state WHERE code = %s", (row["code"],))
            state_map[row["code"]] = cur.fetchone()[0]

    except Exception as e:
        print(f"❌ State Error: {row} | {e}")

conn.commit()
print("✅ States Inserted")

# -------------------------------
# STEP 3: Districts
# -------------------------------
district_map = {}

for _, row in districts_df.iterrows():
    try:
        state_id = state_map[row["state_code"]]

        cur.execute("""
        INSERT INTO district (code, name, state_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (code) DO NOTHING
        RETURNING id;
        """, (row["code"], row["name"], state_id))

        result = cur.fetchone()

        if result:
            district_map[row["code"]] = result[0]
        else:
            cur.execute("SELECT id FROM district WHERE code = %s", (row["code"],))
            district_map[row["code"]] = cur.fetchone()[0]

    except Exception as e:
        print(f"❌ District Error: {row} | {e}")

conn.commit()
print("✅ Districts Inserted")

# -------------------------------
# STEP 4: SubDistricts
# -------------------------------
subdistrict_map = {}

for _, row in subdistricts_df.iterrows():
    try:
        district_id = district_map[row["district_code"]]

        cur.execute("""
        INSERT INTO subdistrict (code, name, district_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (code) DO NOTHING
        RETURNING id;
        """, (row["code"], row["name"], district_id))

        result = cur.fetchone()

        if result:
            subdistrict_map[row["code"]] = result[0]
        else:
            cur.execute("SELECT id FROM subdistrict WHERE code = %s", (row["code"],))
            subdistrict_map[row["code"]] = cur.fetchone()[0]

    except Exception as e:
        print(f"❌ SubDistrict Error: {row} | {e}")

conn.commit()
print("✅ SubDistricts Inserted")

# -------------------------------
# STEP 5: Villages (Batch)
# -------------------------------
batch_size = 5000


for i in range(0, len(villages_df), batch_size):
    batch = villages_df.iloc[i:i+batch_size]

    records = []
    for _, row in batch.iterrows():
        subdistrict_id = subdistrict_map.get(row["subdistrict_code"])
        if subdistrict_id:
            records.append((row["code"], row["name"], subdistrict_id))

    success = False

    while not success:
        try:
            execute_values(
                cur,
                """
                INSERT INTO village (code, name, subdistrict_id)
                VALUES %s
                ON CONFLICT (code) DO NOTHING;
                """,
                records
            )

            conn.commit()
            print(f"Inserted villages {i} → {i+batch_size}")
            success = True

        except psycopg2.OperationalError:
            print(f"⚠️ Connection lost at batch {i}. Reconnecting...")
            time.sleep(2)

            conn = psycopg2.connect(DATABASE_URL)
            cur = conn.cursor()

print("✅ Villages Inserted")

# -------------------------------
# FINAL VERIFICATION
# -------------------------------
print("\n🔍 Verification:")

for table in ["state", "district", "subdistrict", "village"]:
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    print(f"{table}: {cur.fetchone()[0]}")

print(f"\n⏱ Total Time: {round(time.time() - start_time, 2)} sec")

cur.close()
conn.close()

print("\n🎯 DATA IMPORT COMPLETE")