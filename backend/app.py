from groq import BadRequestError
import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from groq import Groq
from database import init_db, update_order_status, get_user, create_user
import re

load_dotenv()

app = Flask(__name__)
CORS(app)  
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # 2 MB limit
with app.app_context():
    init_db()

# Groq client
client = Groq(api_key=os.getenv("GROQ_API_KEY"), timeout=30.0, max_retries=2)
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

def groq_json_completion(prompt: str) -> str:
    """GPT-OSS 120B inference with low reasoning effort for speed."""
    kwargs = dict(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": (
                "You are GreenChoice's sustainability analysis engine. "
                "Return only valid JSON matching the user's requested schema, "
                "without markdown or reasoning traces. "
                "Do not claim product properties that are not evidenced by the input."
            )},
            {"role": "user", "content": prompt},
        ],
        temperature=0,
        max_completion_tokens=4096,
    )
    try:
        completion = client.chat.completions.create(**kwargs, extra_body={"reasoning_effort": "low"})
    except BadRequestError:  # model doesn't support the option
        completion = client.chat.completions.create(**kwargs)
    return (completion.choices[0].message.content or "").strip()


# Dynamic sustainability rubric (kept in app.py; no extra module).

def has(text, pattern):
    # patterns in assess() were written with doubled backslashes inside raw strings
    return bool(re.search(pattern.replace("\\\\", "\\"), text, re.I))

def category_of(text):
    categories = [
        ("oral_care", r"tooth\s?brush|toothpaste|dental floss"),
        ("drinkware", r"water bottle|drinking bottle|flask|tumbler|travel mug"),
        ("personal_care", r"shampoo|soap|lotion|face wash|deodorant|cosmetic"),
        ("clothing", r"t.shirt|shirt|jeans|dress|trouser|hoodie|sweater|jacket"),
        ("electronics", r"phone|laptop|charger|headphone|earbuds|television|tablet"),
        ("cleaning", r"detergent|dishwash|floor cleaner|laundry"),
        ("food", r"snack|coffee|tea|juice|biscuits|chocolate"),
    ]
    return next((name for name, pattern in categories if has(text, pattern)), "other")

def grade_for(score):
    return "A" if score >= 9 else "B" if score >= 7 else "C" if score >= 5 else "D" if score >= 3 else "F"
def estimate_impact(score, cat):
    """Rough per-unit lifecycle estimates; better score => lower impact."""
    base = {
        "clothing": (8.0, 2500), "electronics": (40.0, 1500),
        "drinkware": (1.0, 150), "personal_care": (1.0, 50),
        "cleaning": (1.0, 30), "food": (1.5, 200), "oral_care": (0.3, 20),
    }.get(cat, (2.0, 200))
    factor = 1.5 - (score / 10.0)  # score 10 -> 0.5x, score 0 -> 1.5x
    return round(base[0] * factor, 1), int(base[1] * factor)

def assess(product):
    """Material-first estimate; unknown material is never treated as verified."""
    if isinstance(product, dict):
        title = str(product.get("title") or product.get("name") or "")
        description = str(product.get("description") or "")
        material_field = product.get("material") or product.get("materials") or ""
        if isinstance(material_field, list):
            material_field = " ".join(map(str, material_field))
        material_field = str(material_field)
    else:
        title, description, material_field = str(product), "", ""

    text = " ".join([title, description, material_field]).lower()
    cat = category_of(text)
    # Longer, specific material names must precede generic names.
    signals = [
        ("recycled polyester", r"\\brecycled polyester\\b", 6.5, "Recycled synthetic fibre"),
        ("recycled plastic", r"\\brecycled (?:pet|plastic|polypropylene)\\b|\\brpet\\b", 6.0, "Recycled plastic"),
        ("organic cotton", r"\\borganic cotton\\b", 7.5, "Organic cotton"),
        ("bamboo", r"\\bbamboo\\b", 7.0, "Bamboo (processing and sourcing unverified)"),
        ("hemp", r"\\bhemp\\b", 8.0, "Hemp fibre"),
        ("linen", r"\\blinen\\b|\\bflax\\b", 7.5, "Linen or flax"),
        ("cork", r"\\bcork\\b", 7.5, "Cork"),
        ("jute", r"\\bjute\\b", 7.5, "Jute fibre"),
        ("stainless steel", r"\\bstainless steel\\b", 7.0, "Durable, recyclable steel"),
        ("copper", r"\\bcopper\\b", 7.0, "Durable, recyclable copper"),
        ("aluminium", r"\\balumini?um\\b", 6.5, "Recyclable aluminium"),
        ("glass", r"\\b(?:borosilicate )?glass\\b", 7.0, "Reusable, recyclable glass"),
        ("ceramic", r"\\bceramic\\b|\\bporcelain\\b", 6.5, "Durable ceramic"),
        ("wood", r"\\bwood(?:en)?\\b", 6.5, "Wood; sourcing not verified"),
        ("paper", r"\\bpaper\\b|\\bcardboard\\b", 6.0, "Paper-based material"),
        ("cotton", r"\\bcotton\\b", 6.0, "Cotton"),
        ("wool", r"\\bwool\\b", 6.0, "Wool"),
        ("leather", r"\\bleather\\b", 4.0, "Leather"),
        ("nylon", r"\\bnylon\\b|\\bpolyamide\\b", 3.5, "Synthetic nylon"),
        ("polyester", r"\\bpolyester\\b", 3.5, "Synthetic polyester"),
        ("acrylic", r"\\bacrylic\\b", 3.0, "Synthetic acrylic"),
        ("silicone", r"\\bsilicone\\b", 4.5, "Silicone"),
        ("plastic", r"\\bplastic\\b|\\bpolypropylene\\b|\\bpolyethylene\\b|\\babs\\b|\\bpvc\\b|\\bpet\\b", 3.5, "Conventional plastic"),
    ]
    matches = [(name, value, reason) for name, pattern, value, reason in signals if has(text, pattern)]
    # Avoid double-counting a broad material when its specific variant is present.
    names = {m[0] for m in matches}
    suppress = set()
    if "organic cotton" in names: suppress.add("cotton")
    if "recycled polyester" in names: suppress.add("polyester")
    if "recycled plastic" in names: suppress.add("plastic")
    matches = [m for m in matches if m[0] not in suppress]

    if matches:
        tl = title.lower()
        ws = [3 if m[0] in tl else 1 for m in matches]
        score = round(sum(m[1] * w for m, w in zip(matches, ws)) / sum(ws), 1)
        confidence = "medium" if material_field or description else "low"
        pros = [m[2] for m in matches if m[1] >= 6]
        cons = [m[2] for m in matches if m[1] < 6]
        explanation = "Material-based estimate: " + ", ".join(m[0] for m in matches) + ". Material sourcing, blends and product lifespan are not verified."
    else:
        score, confidence, pros, cons = 5.0, "low", [], ["Product materials could not be identified"]
        explanation = "Insufficient material information for a reliable ranking; neutral provisional score."

    return {
        "numericScore": score, "grade": grade_for(score), "category": cat,
        "confidence": confidence, "positiveFactors": pros, "negativeFactors": cons,
        "explanation": explanation, "materials": [m[0] for m in matches],
        "carbonFootprintKg": estimate_impact(score, cat)[0],
        "waterUsageLiters": estimate_impact(score, cat)[1],
        "used": "material_only_rubric"
    }


MATERIALS = [
    # textiles & natural fibers
    "cotton", "organic cotton", "egyptian cotton", "bamboo", "hemp", "linen",
    "jute", "wool", "silk",
    # synthetics
    "polyester", "microfiber", "nylon", "acrylic", "viscose",
    # materials & packaging
    "plastic", "recycled plastic", "recycled polyester", "rubber", "latex",
    "leather", "metal", "steel", "aluminum", "glass",
    # eco labels
    "recycled", "biodegradable", "compostable", "eco-friendly", "sustainable",
]


MATERIAL_WEIGHTS = {
    
    "organic cotton": +4,
    "bamboo": +4,
    "hemp": +4,
    "linen": +3,
    "jute": +3,
    "recycled": +3,
    "recycled plastic": +2,
    "recycled polyester": +1,
    "biodegradable": +3,
    "compostable": +3,
    "eco-friendly": +2,
    "sustainable": +2,

    "cotton": +2,
    "egyptian cotton": +2,
    "wool": +1,
    "silk": +1,

    "polyester": -3,
    "microfiber": -3,
    "nylon": -3,
    "acrylic": -3,
    "viscose": -2,
    "plastic": -3,
    "rubber": -1,
    "latex": -1,
    "leather": -2,
}


def detect_materials(text: str):
    if not text:
        return []
    lower = text.lower()
    found = [mat for mat in MATERIALS if mat in lower]
    return sorted(set(found))


def compute_heuristic_score(text: str) -> float:
    return assess(text)["numericScore"]


def map_score_to_grade(score) -> str:
    return grade_for(float(score))


def build_explanation(materials, score: int) -> str:
    parts = []

    if materials:
        parts.append("Detected materials/keywords: " + ", ".join(materials) + ".")

    if score >= 8:
        parts.append("Overall this product appears highly eco-friendly based on the detected terms.")
    elif score >= 5:
        parts.append("Overall this product shows good sustainability characteristics.")
    elif score >= 2:
        parts.append("This product has a mix of positive and neutral sustainability traits.")
    elif score >= 0:
        parts.append("This product has mixed or unclear sustainability signals.")
    else:
        parts.append("This product likely has notable environmental drawbacks.")

    lower_materials = " ".join(materials).lower() if materials else ""

    if any(x in lower_materials for x in ["bamboo", "hemp", "organic", "recycled", "compostable", "biodegradable"]):
        parts.append("The presence of natural or recycled materials is a positive sign.")
    if any(x in lower_materials for x in ["plastic", "polyester", "nylon", "synthetic"]):
        parts.append("However, plastic or synthetic components can increase carbon footprint and reduce recyclability.")

    return " ".join(parts).strip()


def clamp(value, min_value, max_value):
    return max(min_value, min(max_value, value))


def calculate_trend(prices_data):
    """
    Simple linear regression to predict trend.
    prices_data: list of dicts { 'price': float, 'timestamp': datetime object }
    Returns: { 'trend': 'up'|'down'|'stable', 'slope': float, 'prediction_next_week': float }
    """
    if not prices_data or len(prices_data) < 2:
        return {'trend': 'insufficient_data', 'slope': 0, 'prediction_next_week': None}

    import time
    
    sorted_data = sorted(prices_data, key=lambda x: x['timestamp'])
    base_time = sorted_data[0]['timestamp'].timestamp()
    
    x = [] # Days elapsed
    y = [] # Price
    
    for p in sorted_data:
        days = (p['timestamp'].timestamp() - base_time) / (60 * 60 * 24)
        x.append(days)
        y.append(p['price'])
        
    n = len(x)
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(xi * yi for xi, yi in zip(x, y))
    sum_xx = sum(xi ** 2 for xi in x)
    
    if n * sum_xx - sum_x ** 2 == 0:
        slope = 0
    else:
        slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x ** 2)
        
    intercept = (sum_y - slope * sum_x) / n

    last_day = x[-1]
    prediction = slope * (last_day + 7) + intercept
    
    trend = 'stable'
    if slope > 0.5:
        trend = 'up'
    elif slope < -0.5:
        trend = 'down'
        
    return {
        'trend': trend,
        'slope': slope,
        'prediction_next_week': max(0, prediction)
    }


def fallback_analysis(text: str) -> dict:
    return assess(text)


def _num(v, default):
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return default


import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse, parse_qs

SCORE_VERSION = "v2"  # bump to invalidate cached scores after changing the guide or weights
SCORE_CACHE = {}
WEIGHTS = {"materials": 0.40, "lifespan": 0.25, "endOfLife": 0.20, "evidence": 0.15}
LABELS = {"materials": "Materials", "lifespan": "Lifespan/reuse",
          "endOfLife": "End of life", "evidence": "Evidence"}

SCORING_GUIDE = """You rate the environmental sustainability of ANY consumer product (clothing, electronics, food, home, beauty, toys, books, appliances, etc.) from the text given.
Rate each factor 0-10 (10 = best for the environment), using the same scale for every product type:
- materials: footprint of the main materials and manufacturing for this kind of product. Natural, renewable, recycled or low-impact = high; virgin plastics, synthetics, energy- or water-intensive materials = low.
- lifespan: durability, reusability, repairability. Single-use or disposable = low; long-lasting or reusable = high.
- endOfLife: recyclability, biodegradability, take-back. Mixed or non-recyclable materials = low.
- evidence: credible, specific proof in the text (named certifications, recycled %, material composition). Vague words like "eco-friendly" alone = 3-4; no claims at all = 5.
Judge the main body of the product, not marketing words or small components. If a material is not stated, infer the typical one for that product type and mark it "(assumed)".
Be consistent: identical product types with identical materials must get identical ratings."""


def parse_json(raw):
    raw = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.M).strip()
    return json.loads(raw)


def score_key(url, title):
    url = (url or "").strip()
    if url:
        m = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})", url, re.I)
        if m:
            return f"{SCORE_VERSION}:amazon:" + m.group(1).upper()
        u = urlparse(url)
        pid = parse_qs(u.query).get("pid")
        if pid and "flipkart" in u.netloc:
            return f"{SCORE_VERSION}:flipkart:" + pid[0]
        return f"{SCORE_VERSION}:" + (u.netloc + u.path).rstrip("/").lower()
    return f"{SCORE_VERSION}:t:" + re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()


def _db():
    from database import get_db_connection
    conn = get_db_connection()
    conn.execute("CREATE TABLE IF NOT EXISTS score_cache (key TEXT PRIMARY KEY, data TEXT)")
    return conn


def cache_get(key):
    if key in SCORE_CACHE:
        return SCORE_CACHE[key]
    try:
        conn = _db()
        row = conn.execute("SELECT data FROM score_cache WHERE key = ?", (key,)).fetchone()
        conn.close()
        if row:
            SCORE_CACHE[key] = json.loads(row[0])
            return SCORE_CACHE[key]
    except Exception as e:
        print("cache read failed:", e, flush=True)
    return None


def cache_set(key, value):
    SCORE_CACHE[key] = value
    try:
        conn = _db()
        conn.execute("INSERT OR REPLACE INTO score_cache (key, data) VALUES (?, ?)",
                     (key, json.dumps(value)))
        conn.commit()
        conn.close()
    except Exception as e:
        print("cache write failed:", e, flush=True)


def llm_score_batch(items):
    listing = "\n".join(f'{i["id"]}. {i["text"][:1200]}' for i in items)
    prompt = f"""{SCORING_GUIDE}

Products:
{listing}

Return JSON only:
{{"results": [{{"id": <id>, "productType": "1-3 words", "materials": ["at least one"], "materialsScore": <0-10>, "lifespanScore": <0-10>, "endOfLifeScore": <0-10>, "evidenceScore": <0-10>, "carbonFootprintKg": <number>, "waterUsageLiters": <number>, "confidence": "low|medium|high"}}]}}
Carbon (kg CO2e) and water (litres) are rough lifecycle estimates for one unit; never null."""
    data = parse_json(groq_json_completion(prompt))
    return {int(r["id"]): r for r in data.get("results", []) if "id" in r}


def _build_result(r):
    f = {k: clamp(float(r[k + "Score"]), 0.0, 10.0) for k in WEIGHTS}
    score = round(sum(f[k] * w for k, w in WEIGHTS.items()), 1)
    mats = r.get("materials") or ["not stated"]
    if isinstance(mats, str):
        mats = [mats]
    return {
        "numericScore": score, "grade": grade_for(score),
        "category": r.get("productType", ""), "materials": mats,
        "carbonFootprintKg": _num(r.get("carbonFootprintKg"), None),
        "waterUsageLiters": _num(r.get("waterUsageLiters"), None),
        "explanation": r.get("explanation", ""),
        "confidence": r.get("confidence", "medium"),
        "positiveFactors": [f"{LABELS[k]} ({f[k]:g}/10)" for k in f if f[k] >= 7],
        "negativeFactors": [f"{LABELS[k]} ({f[k]:g}/10)" for k in f if f[k] <= 4],
        "factors": f, "used": "llm",
    }


def score_products(products, chunk=15):
    """Returns a list aligned with `products`: a result dict, or None if the LLM could not score it."""
    out = [None] * len(products)
    todo = []
    for i, p in enumerate(products):
        key = score_key(p.get("url"), p.get("title"))
        hit = cache_get(key)
        if hit:
            out[i] = hit
        else:
            text = " ".join([str(p.get("title") or ""), str(p.get("description") or ""),
                             str(p.get("material") or "")]).strip()
            todo.append((i, key, text))

    def run(batch):
        for _ in range(2):  # one retry
            try:
                return llm_score_batch([{"id": n, "text": t[2]} for n, t in enumerate(batch)])
            except Exception as e:
                print("Groq batch failed:", e, flush=True)
        return {}

    t0 = time.time()
    batches = [todo[k:k + chunk] for k in range(0, len(todo), chunk)]
    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(run, batches))
    if todo:
        print(f"[score] {len(todo)} new products, {len(batches)} batches: {time.time() - t0:.1f}s", flush=True)
    for batch, res in zip(batches, results):
        for n, (i, key, text) in enumerate(batch):
            try:
                final = _build_result(res[n])
            except Exception:
                continue
            cache_set(key, final)
            out[i] = final
    return out

def add_explanation(res, key, text):
    """Writes the summary for one product without changing its cached scores."""
    prompt = f"""Product: {text[:1200]}

Sustainability ratings (0-10): {json.dumps(res["factors"])}; materials: {", ".join(res["materials"])}; overall {res["numericScore"]}/10.
Write a 2-3 sentence plain-language summary explaining this score using only evidence in the product text. Do not change the ratings.
Return JSON only: {{"explanation": "..."}}"""
    try:
        res = {**res, "explanation": parse_json(groq_json_completion(prompt)).get("explanation", "")}
        cache_set(key, res)
    except Exception as e:
        print("explain failed:", e, flush=True)
    return res

def ai_score(text: str) -> dict:
    r = score_products([{"title": text}])[0]
    if not r:
        raise RuntimeError("scoring unavailable")
    return r


@app.post("/classify")
# def classify():
#     """
#     Lightweight AI-like category + gender classifier used by extension
#     Does NOT change scoring logic. Only used to group similar products.
#     """

#     payload = request.get_json(silent=True) or {}

#     text = " ".join([
#         payload.get("title", ""),
#         payload.get("breadcrumb", ""),
#         payload.get("description", "")
#     ]).lower()

#     if not text.strip():
#         return jsonify({"category": "unknown", "gender": "unisex"})

   
#     try:
#         prompt = f"""
#         You will classify an e-commerce product.

#         Text:
#         {text}

#         Decide:
#         - best high-level category
#         - gender (male / female / unisex)

#         Categories allowed:
#         - clothing_textiles
#         - women_ethnic
#         - footwear
#         - electronics
#         - accessories
#         - beauty_personal_care
#         - home_kitchen
#         - food_beverage
#         - toys
#         - generic_other

#         Output JSON only:

#         {{
#           "category": "...",
#           "gender": "male/female/unisex"
#         }}
#         """

#         raw = groq_json_completion(prompt)

#         try:
#             data = json.loads(raw)
#             cat = data.get("category", "unknown")
#             gen = data.get("gender", "unisex")
#             return jsonify({"category": cat, "gender": gen})
#         except Exception:
#             pass

#     except Exception:
#         pass  # fail to heuristic fallback

#     if any(x in text for x in ["saree", "lehenga", "anarkali", "salwar", "kurti"]):
#         category = "women_ethnic"
#     elif any(x in text for x in ["shirt", "tshirt", "dress", "jeans", "trouser", "hoodie", "top"]):
#         category = "clothing_textiles"
#     elif any(x in text for x in ["shoe", "sandal", "sneaker", "boot"]):
#         category = "footwear"
#     elif any(x in text for x in ["phone", "laptop", "earphone", "headphone", "smartwatch", "camera"]):
#         category = "electronics"
#     elif any(x in text for x in ["cream", "shampoo", "lipstick", "lotion", "soap"]):
#         category = "beauty_personal_care"
#     elif any(x in text for x in ["towel", "bottle", "pan", "cookware", "bedsheet", "pillow", "mattress"]):
#         category = "home_kitchen"
#     else:
#         category = "generic_other"

#     if any(x in text for x in ["women", "ladies", "girl", "female"]):
#         gender = "female"
#     elif any(x in text for x in ["men", "male", "boy"]):
#         gender = "male"
#     else:
#         gender = "unisex"

#     return jsonify({"category": category, "gender": gender})

@app.post("/classify")
def classify():
    payload = request.get_json(silent=True) or {}
    text = " ".join([payload.get("title", ""), payload.get("breadcrumb", ""),
                     payload.get("description", "")[:600]]).strip()
    if not text:
        return jsonify({"category": "unknown", "productType": "", "gender": "unisex", "query": ""})
    prompt = f"""Analyse this e-commerce product (any category).

Text: {text}

Return JSON only:
{{"category": "short snake_case category", "productType": "what the item is, 1-3 words",
  "gender": "male|female|unisex",
  "query": "3-6 word search query a shopper would type to find similar products; include gender/age only if the product is gendered; no brand names or marketing words"}}"""
    try:
        d = parse_json(groq_json_completion(prompt))
        return jsonify({"category": d.get("category", "unknown"),
                        "productType": d.get("productType", ""),
                        "gender": d.get("gender", "unisex"),
                        "query": d.get("query", "")})
    except Exception as e:
        print("classify failed:", e, flush=True)
        return jsonify({"category": "unknown", "productType": "", "gender": "unisex", "query": ""})


@app.post("/cross_site_compare")
def cross_site_compare():
    payload = request.get_json(silent=True) or {}
    base = payload.get("base") or {}
    cands, seen = [], set()
    for s in payload.get("sites") or []:
        site = s.get("site") or s.get("name") or "Unknown"
        for p in (s.get("products") or [])[:12]:
            title = str(p.get("title") or p.get("name") or "").strip()
            url = str(p.get("url") or "").strip()
            key = score_key(url, title)
            if not title or key in seen:
                continue
            seen.add(key)
            cands.append({"id": len(cands), "site": site, "title": title,
                          "url": url, "price": str(p.get("price") or "")})
    if not cands:
        return jsonify({"ranked": []})

    listing = "\n".join(f'{c["id"]}. {c["title"]}' for c in cands)
    prompt = f"""A shopper is viewing this product:
Title: {str(base.get("title", ""))[:300]}
Type: {base.get("productType", "")}   Intended for: {base.get("gender", "unisex")}

Candidates from other shopping sites:
{listing}

Return the ids of candidates that are the same kind of product and a sensible substitute (same product type, same intended user such as gender or age group). Exclude accessories, refills, and different product types.
Return JSON only: {{"keep": [ids]}}"""
    try:
        keep = {int(i) for i in parse_json(groq_json_completion(prompt)).get("keep", [])}
    except Exception as e:
        print("relevance filter failed:", e, flush=True)
        return jsonify({"error": "Matching unavailable, try again"}), 503

    kept = [c for c in cands if c["id"] in keep]
    scored = score_products(kept)
    ranked = [{"site": c["site"], "name": c["title"], "url": c["url"], "price": c["price"],
               "numericScore": s["numericScore"], "grade": s["grade"],
               "materials": s.get("materials", []), "explanation": s.get("explanation", "")}
              for c, s in zip(kept, scored) if s]
    ranked.sort(key=lambda r: r["numericScore"], reverse=True)
    return jsonify({"ranked": ranked})
def ai_score_alternatives(names: list[str]) -> list[dict]:
    """
    Fast multi-product scoring:
    Takes a list of product names (strings) and returns
    a list of { "name", "numericScore", "grade" } dicts.
    Only ONE Groq call for all products.
    """

@app.post("/analyze")

def analyze():
    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title required"}), 400
    ai = score_products([{"title": title, "url": payload.get("url") or "",
                          "description": payload.get("description") or "",
                          "material": str(payload.get("material") or "")}])[0]
    if not ai:
        return jsonify({"error": "Scoring unavailable, try again"}), 503
    if not ai.get("explanation"):
        text = " ".join([title, payload.get("description") or ""])
        ai = add_explanation(ai, score_key(payload.get("url") or "", title), text)
    keys = ("numericScore", "grade", "materials", "carbonFootprintKg", "waterUsageLiters",
            "explanation", "used", "confidence", "positiveFactors", "negativeFactors")
    return jsonify({k: ai.get(k) for k in keys})
def ai_score_alternatives(names: list[str]) -> list[dict]:
    return [{"name": name, **assess(name)} for name in names]


@app.post("/alternatives")
def alternatives():
    """
    Analyze a list of alternative products.
    Expects JSON:
      { "products": [ {title, url, price?} or strings ] }

    Returns:
      {
        "alternatives": [
          {
            "name": "...",
            "url": "...",
            "price": "...",
            "numericScore": ...,
            "grade": "A/B/C/D/F"
          },
          ...
        ]
      }
    """
    payload = request.get_json(silent=True) or {}
    products = payload.get("products")

    if not isinstance(products, list):
        return jsonify({"error": "products array required"}), 400

#Normalize input into a clean list of product objects 
    normalized = []
    names = []

    for p in products[:60]:   # bounded page-wide analysis
        if isinstance(p, dict):
       
            title = (
                (p.get("title") or "").strip()
                or (p.get("name") or "").strip()
                or (p.get("label") or "").strip()
            )
            url = (p.get("url") or "").strip()
            price = str(p.get("price") or "").strip()
        else:
            title = str(p).strip()
            url = ""
            price = ""

        # skip anything without a proper title – do NOT fall back to URL
        if not title:
            continue

        normalized.append({
        "title": title,
        "url": url,
        "price": price,
            "description": str(p.get("description") or "") if isinstance(p, dict) else "",
            "material": str(p.get("material") or "") if isinstance(p, dict) else "",
        })
        names.append(title)


    if not names:
        return jsonify({"alternatives": []})

    scored = score_products(normalized)
    results = []
    for prod, s in zip(normalized, scored):
        if not s:
            continue  # unscored products are left out of rankings rather than guessed
        results.append({
            "name": prod["title"], "url": prod["url"], "price": prod["price"],
            "numericScore": s["numericScore"], "grade": s["grade"],
            "confidence": s.get("confidence", "medium"),
            "explanation": s.get("explanation", ""),
            "positiveFactors": s.get("positiveFactors", []),
            "negativeFactors": s.get("negativeFactors", []),
            "materials": s.get("materials", []),
        })

    if normalized and not results:
        return jsonify({"error": "Scoring unavailable, try again"}), 503

    results.sort(key=lambda r: float(r.get("numericScore") or 0), reverse=True)
    return jsonify({"alternatives": results})

# Compare products by cost + sustainability
@app.post("/compare_products")
def compare_products():
    """
    Compare products on a combined Cost + Sustainability basis.

    Output fields (per product):
      - numericScore: sustainability score from AI/heuristic (roughly -10..10 or 0..10 depending on model)
      - sustainNorm: numericScore normalized to 0..1
      - priceNorm: relative affordability score 0..1 (cheaper => higher)
      - valueIndex: weighted blend 0..1
      - valueScore: valueIndex mapped to 0..100 (for UI)
    """
    payload = request.get_json(silent=True) or {}
    products = payload.get("products", [])

    if not isinstance(products, list) or not products:
        return jsonify({"error": "products array required"}), 400

    #Pre-read prices to compute min price for normalization
    clean_products = []
    prices = []
    for prod in products:
        name = str(prod.get("name") or "").strip()
        if not name:
            continue

        raw_price = prod.get("rawPrice", "")
        price = prod.get("price")

        parsed_price = None
        try:
            parsed_price = float(price)
        except Exception:
            parsed_price = None

        if (parsed_price is None) and raw_price:
            # e.g. "₹999", "Rs. 1,299", "1,299"
            try:
                import re
                m = re.findall(r"[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?", str(raw_price))
                if m:
                    parsed_price = float(m[0].replace(",", ""))
            except Exception:
                parsed_price = None

        if parsed_price is not None and parsed_price <= 0:
            parsed_price = None

        price = parsed_price

        # If UI price text is missing but numeric price exists, reconstruct a readable ₹ price.
        if (not raw_price) and price:
            # no decimals for typical apparel pricing
            try:
                raw_price = f"₹{int(round(price)):,}"
            except Exception:
                raw_price = f"₹{price}"

        if price:
            prices.append(price)

        clean_products.append({
            "name": name,
            "url": str(prod.get("url") or ""),
            "rawPrice": raw_price,
            "price": price,
            "description": str(prod.get("description") or ""),
            "material": str(prod.get("material") or ""),
        })

    if not clean_products:
        return jsonify({"ranked": [], "best": None})

    min_price = min(prices) if prices else None

    ranked = []
    scored_all = score_products([{**p, "title": p["name"]} for p in clean_products])
    ranked = []
    for prod, ai in zip(clean_products, scored_all):
        if not ai:
            continue
        name = prod["name"]
        price = prod["price"]
        raw_price = prod["rawPrice"]
        numeric = float(ai["numericScore"])

        # All sustainability scores are consistently 0..10.
        sustain_norm = clamp(numeric / 10.0, 0.0, 1.0)

        #Price normalization 
        if price and min_price:
            price_norm = min_price / price  # cheapest gets 1.0
        elif min_price is None:
            price_norm = 0.5  # neutral if no prices available
        else:
            price_norm = 0.0  # missing price while others exist

        price_norm = clamp(price_norm, 0.0, 1.0)

        #Weighted combined value score 
        value_index = (0.65 * sustain_norm) + (0.35 * price_norm)
        value_index = clamp(value_index, 0.0, 1.0)

        ranked.append({
            "name": name,
            "url": str(prod.get("url") or ""),
            "rawPrice": raw_price,
            "price": price,
            "numericScore": numeric,
            "grade": grade_for(numeric),
            "confidence": ai.get("confidence", "low"),
            "explanation": ai.get("explanation", ""),
            "sustainNorm": round(float(sustain_norm), 4),
            "priceNorm": round(float(price_norm), 4),
            "valueIndex": round(float(value_index), 6),
            "valueScore": round(float(value_index) * 100.0, 1),
        })

    if not ranked:
        return jsonify({"error": "Scoring unavailable, try again"}), 503

    ranked.sort(key=lambda x: x["valueIndex"], reverse=True)

    return jsonify({
        "ranked": ranked,
        "best": ranked[0] if ranked else None
    })



# -----------------------------
# Streak & Order Management routes
# -----------------------------

@app.post("/track_price")
def track_price():
    """
    Record the current price of a product.
    Expects: { "url": str, "name": str, "price": float }
    """
    data = request.get_json(silent=True) or {}
    url = data.get("url")
    price = data.get("price")
    name = data.get("name", "")
    
    if not url or price is None:
        return jsonify({"error": "Missing url or price"}), 400
        
    try:
        price = float(price)
    except:
        return jsonify({"error": "Invalid price"}), 400
        
    import datetime
    from database import get_db_connection
    
    conn = get_db_connection()
    timestamp = datetime.datetime.now().isoformat()
    
    # Check if we recently added this price (debounce) to avoid duplicates from page reloads
    # Look for same url and price within last hour
    cursor = conn.cursor()
    last_entry = cursor.execute('''
        SELECT timestamp, price FROM price_history 
        WHERE product_url = ? 
        ORDER BY id DESC LIMIT 1
    ''', (url,)).fetchone()
    
    should_insert = True
    if last_entry:
        last_time = datetime.datetime.fromisoformat(last_entry['timestamp'])
        last_price = last_entry['price']
        now = datetime.datetime.now()
        
        # If same price and less than 1 hour, skip
        if last_price == price and (now - last_time).total_seconds() < 3600:
            should_insert = False
            
    if should_insert:
        cursor.execute('''
            INSERT INTO price_history (product_url, product_name, price, timestamp)
            VALUES (?, ?, ?, ?)
        ''', (url, name, price, timestamp))
        conn.commit()
    
    conn.close()
    
    return jsonify({"success": True, "inserted": should_insert})


@app.post("/price_trend")
def price_trend():
    """
    Get price history and trend prediction.
    Expects: { "url": str }
    """
    data = request.get_json(silent=True) or {}
    url = data.get("url")
    
    if not url:
        return jsonify({"error": "Missing url"}), 400
        
    from database import get_db_connection
    import datetime
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    rows = cursor.execute('''
        SELECT price, timestamp FROM price_history
        WHERE product_url = ?
        ORDER BY timestamp ASC
    ''', (url,)).fetchall()
    
    conn.close()
    
    if not rows:
        return jsonify({"history": [], "trend": "no_data", "prediction": None})
        
    parse_data = []
    history = []
    
    for r in rows:
        dt = datetime.datetime.fromisoformat(r['timestamp'])
        parse_data.append({'price': r['price'], 'timestamp': dt})
        history.append({'price': r['price'], 'date': dt.strftime('%Y-%m-%d')})
        
    analysis = calculate_trend(parse_data)
    
    return jsonify({
        "history": history,
        "trend": analysis['trend'],
        "prediction": analysis['prediction_next_week'],
        "slope": analysis['slope']
    })
# -----------------------------

@app.route("/update_order", methods=["POST"])
def update_order_route():
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")
    order_id = data.get("order_id")
    status = data.get("status")
    
    if not all([user_id, order_id, status]):
        return jsonify({"error": "Missing required fields"}), 400

    product_name = data.get("product_name")
    sustainability_score = data.get("sustainability_score")
    carbon_credits = data.get("carbon_credits")

    # Auto-calculate score if missing and product_name is present
    if product_name and sustainability_score is None:
        try:
            # Try AI score first
            # Note: ai_score returns a dict
            score_data = ai_score(product_name)
            sustainability_score = score_data.get("numericScore", 0)
        except:
            # Fallback
            sustainability_score = compute_heuristic_score(product_name)
            
        # Credits roughly derived from score if positive
        # simple heuristic: 0.1 credit per score point > 0, max 1.0?
        # User requirement: "Carbon credit calculation system" exists.
        # "Existing carbon and water impact equations must remain functional."
        # We'll use a simple credit formula: score * 0.1 (capped at 1.0)
        if carbon_credits is None:
            if sustainability_score > 0:
                carbon_credits = min(1.0, sustainability_score * 0.1)
            else:
                carbon_credits = 0.0

    try:
        updated_order = update_order_status(
            user_id, 
            order_id, 
            status, 
            product_name, 
            sustainability_score, 
            carbon_credits
        )
        
        # Get updated user
        import database
        # Need to re-import or use existing import? 'get_user' is imported.
        user = get_user(user_id)
        
        return jsonify({
            "message": "Order updated", 
            "order_status": updated_order['order_status'],
            "streak_awarded": updated_order['streak_awarded'] == 1,
            "current_streak": user['current_streak'],
            "total_credits": user['total_carbon_credits'],
            "carbon_rewards": user['carbon_rewards']
        })
    except Exception as e:
        print("Error in update_order:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/user_streak", methods=["GET"])
def get_user_streak_route():
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
        
    user = get_user(user_id)
    if not user:
        create_user(user_id)
        user = get_user(user_id)
    
    return jsonify({
        "current_streak": user['current_streak'],
        "longest_streak": user['longest_streak'],
        "last_sustainable_purchase_date": user['last_sustainable_purchase_date'],
        "total_credits": user['total_carbon_credits'],
        "carbon_rewards": user['carbon_rewards']
    })

if __name__ == "__main__":

    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)

