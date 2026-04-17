import pandas as pd
import os
import shutil

input_folder = "data"
processed_folder = "processed"
entities_folder = "entities"
rejected_folder = "rejected_data"

os.makedirs(processed_folder, exist_ok=True)
os.makedirs(entities_folder, exist_ok=True)
os.makedirs(rejected_folder, exist_ok=True)

column_mapping = {
    "mdds_stc": ["mdds stc"],
    "state_name": ["state name"],
    "mdds_dtc": ["mdds dtc"],
    "district_name": ["district name"],
    "mdds_sub_dt": ["mdds sub_dt", "mdds sub dt"],
    "sub-district_name": ["sub-district name", "sub district name"],
    "mdds_plcn": ["mdds plcn"],
    "area_name": ["area name"]
}

def standardize_columns(df):
    new_columns = {}
    for col in df.columns:
        clean_col = col.strip().lower().replace("_", " ")
        for standard, variations in column_mapping.items():
            if clean_col in variations:
                new_columns[col] = standard
    return df.rename(columns=new_columns)

# -------------------------------
# SAFE MOVE FUNCTION (handles file lock)
# -------------------------------
def move_to_rejected(src, dst):
    try:
        shutil.move(src, dst)
    except PermissionError:
        print(f"⚠️ File locked, retrying: {src}")
        import time
        time.sleep(2)
        shutil.move(src, dst)

# -------------------------------
# GLOBAL CONTAINERS
# -------------------------------
all_states, all_districts, all_subdistricts, all_villages = [], [], [], []
skipped_files = []

# -------------------------------
# PROCESS FILES
# -------------------------------
for file in os.listdir(input_folder):
    if file.endswith(".csv"):

        input_path = os.path.join(input_folder, file)
        output_path = os.path.join(processed_folder, f"cleaned_{file}")

        # Skip already processed
        if os.path.exists(output_path):
            print(f"⏭️ Skipping already processed: {file}")
            continue

        print(f"Processing: {file}")

        try:
            df = pd.read_csv(input_path, low_memory=False)

            # Clean column names
            df.columns = df.columns.str.strip().str.lower()
            df = standardize_columns(df)

            required_cols = [
                "state_name", "district_name",
                "sub-district_name", "area_name",
                "mdds_stc", "mdds_dtc",
                "mdds_sub_dt", "mdds_plcn"
            ]

            # Invalid schema → move to rejected
            if not all(col in df.columns for col in required_cols):
                print(f"⚠️ Invalid schema, moving to rejected: {file}")
                skipped_files.append(file)
                move_to_rejected(input_path, os.path.join(rejected_folder, file))
                continue

            # -------------------------------
            # CLEANING
            # -------------------------------
            df = df.dropna(how='all')

            for col in df.select_dtypes(include='object'):
                df[col] = df[col].astype(str).str.strip()

            # Remove fake hierarchy rows
            df = df[
                (df["district_name"] != df["state_name"]) &
                (df["sub-district_name"] != df["district_name"]) &
                (df["area_name"] != df["sub-district_name"])
            ]

            # Remove summary rows
            df = df[
                (df["mdds_dtc"] != 0) &
                (df["mdds_sub_dt"] != 0)
            ]

            # Save cleaned file
            df.to_csv(output_path, index=False)

            # -------------------------------
            # EXTRACT ENTITIES (CRITICAL)
            # -------------------------------
            all_states.append(df[["mdds_stc", "state_name"]].drop_duplicates())
            all_districts.append(df[["mdds_dtc", "district_name", "mdds_stc"]].drop_duplicates())
            all_subdistricts.append(df[["mdds_sub_dt", "sub-district_name", "mdds_dtc"]].drop_duplicates())
            all_villages.append(df[["mdds_plcn", "area_name", "mdds_sub_dt"]].drop_duplicates())

        except Exception as e:
            print(f"❌ Error in {file}: {e}")
            skipped_files.append(file)
            if os.path.exists(input_path):
                move_to_rejected(input_path, os.path.join(rejected_folder, file))

# -------------------------------
# COMBINE + CLEAN ENTITIES
# -------------------------------
if all_states:

    states_df = pd.concat(all_states).drop_duplicates(subset=["mdds_stc"])
    districts_df = pd.concat(all_districts).drop_duplicates(subset=["mdds_dtc"])
    subdistricts_df = pd.concat(all_subdistricts).drop_duplicates(subset=["mdds_sub_dt"])
    villages_df = pd.concat(all_villages).drop_duplicates(subset=["mdds_plcn"])

    print("\n📊 ENTITY SHAPES:")
    print("States:", states_df.shape)
    print("Districts:", districts_df.shape)
    print("SubDistricts:", subdistricts_df.shape)
    print("Villages:", villages_df.shape)

    # -------------------------------
    # RENAME COLUMNS (DB READY)
    # -------------------------------
    states_df.columns = ["code", "name"]
    districts_df.columns = ["code", "name", "state_code"]
    subdistricts_df.columns = ["code", "name", "district_code"]
    villages_df.columns = ["code", "name", "subdistrict_code"]

    # -------------------------------
    # REMOVE NULL VALUES (AFTER RENAME)
    # -------------------------------
    subdistricts_df = subdistricts_df.dropna(subset=["code", "name"])
    villages_df = villages_df.dropna(subset=["code", "subdistrict_code"])

    # -------------------------------
    # SAVE ENTITIES
    # -------------------------------
    states_df.to_csv(os.path.join(entities_folder, "states.csv"), index=False)
    districts_df.to_csv(os.path.join(entities_folder, "districts.csv"), index=False)
    subdistricts_df.to_csv(os.path.join(entities_folder, "subdistricts.csv"), index=False)
    villages_df.to_csv(os.path.join(entities_folder, "villages.csv"), index=False)

# -------------------------------
# FINAL LOGS
# -------------------------------
print("\n✅ DONE")

if skipped_files:
    print("\n⚠️ Rejected Files:")
    for f in skipped_files:
        print(f)