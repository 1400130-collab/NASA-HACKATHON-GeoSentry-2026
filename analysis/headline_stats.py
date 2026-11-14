"""Uncertainty and workload numbers for the headline result. Reads site/data/korea/meta.json only.
Output: site/data/korea/stats.json
Run: python3 analysis/headline_stats.py"""
import json
from math import comb
from pathlib import Path
from scipy.stats import beta
import numpy as np

SITE = Path(__file__).resolve().parents[1] / "site" / "data" / "korea"
m = json.load(open(SITE / "meta.json"))
s, lv = m["suscept"], m["levels"]
n = s["n_failed"]


def exact_ci(k, n, level=0.90):
    a = (1 - level) / 2
    lo = 0.0 if k == 0 else beta.ppf(a, k, n - k + 1)
    hi = 1.0 if k == n else beta.ppf(1 - a, k + 1, n - k)
    return [round(float(lo), 3), round(float(hi), 3)]


def p_at_least(k, n, p):
    return sum(comb(n, i) * p**i * (1 - p)**(n - i) for i in range(k, n + 1))


rows = {}
for key, label in [("model_national", "Our model"), ("steep_and_burned", "Steep + burned rule"), ("steepness_only", "Steepness only")]:
    k = round(s["results"][key]["capture_top5"] * n)
    rows[key] = {"label": label, "found": k, "of": n, "share": k / n, "ci90": exact_ci(k, n),
                 "p_vs_chance": round(p_at_least(k, n, 0.05), 4)}
by_county = np.array([v for v in lv["check_first_by_county"].values()])
out = {
    "top_share": 0.05, "n_failed": n, "labels_human_checked": s["labels_human_checked"], "rows": rows,
    "workload": {
        "slopes": lv["slope_units"], "check_first": lv["levels"]["check_first"],
        "check_first_share": round(lv["levels"]["check_first"] / lv["slope_units"], 4),
        "counties_with_any": int((by_county > 0).sum()),
        "per_county_median": float(np.median(by_county)), "per_county_max": int(by_county.max()),
        # in the test region: slopes an officer visits under the top-5% cut, and failures they would have reached
        "region_units": s["n_units"], "region_top5_visits": round(s["n_units"] * 0.05),
        "region_failures_reached": rows["model_national"]["found"], "random_failures_reached": n * 0.05,
    },
}
json.dump(out, open(SITE / "stats.json", "w"), indent=1)
print(json.dumps(out, indent=1))
