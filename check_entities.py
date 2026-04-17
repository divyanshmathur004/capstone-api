import pandas as pd

states = pd.read_csv("entities/states.csv")
districts = pd.read_csv("entities/districts.csv")
subdistricts = pd.read_csv("entities/subdistricts.csv")
villages = pd.read_csv("entities/villages.csv")

print("\nSHAPES:")
print("States:", states.shape)
print("Districts:", districts.shape)
print("SubDistricts:", subdistricts.shape)
print("Villages:", villages.shape)

print("\nDUPLICATES CHECK:")
print("States:", states['code'].duplicated().sum())
print("Districts:", districts['code'].duplicated().sum())
print("SubDistricts:", subdistricts['code'].duplicated().sum())
print("Villages:", villages['code'].duplicated().sum())

print("\nNULL CHECK:")
print(states.isnull().sum())
print(districts.isnull().sum())
print(subdistricts.isnull().sum())
print(villages.isnull().sum())