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
<<<<<<< Updated upstream
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
=======
client = Groq(api_key=os.getenv("GROQ_API_KEY"), timeout=60.0, max_retries=2)
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")


def groq_json_completion(prompt: str) -> str:
    """GPT-OSS 120B inference; keep existing response parsing and fallback logic."""
    completion = client.chat.completions.create(
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
    return (completion.choices[0].message.content or "").strip()


# Dynamic sustainability rubric (kept in app.py; no extra module).

def has(text, pattern):
    return bool(re.search(pattern, text, re.I))

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
        score = round(sum(m[1] for m in matches) / len(matches), 1)
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
        "carbonFootprintKg": None, "waterUsageLiters": None,
        "used": "material_only_rubric"
    }

>>>>>>> Stashed changes

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


<<<<<<< Updated upstream
def compute_heuristic_score(text: str) -> int:
    """
    Simple keyword-based sustainability score:
    positive materials add points, harmful synthetics subtract.
    Result is clamped to [-10, 10].
    """
    if not text:
        return 0

    lower = text.lower()
    score = 0

    for kw, weight in MATERIAL_WEIGHTS.items():
        if kw in lower:
            score += weight

    if "recycled" in lower and "recycled " not in lower:
        score += 2

    if score > 10:
        score = 10
    if score < -10:
        score = -10
    return score
=======
def compute_heuristic_score(text: str) -> float:
    return assess(text)["numericScore"]
>>>>>>> Stashed changes


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


<<<<<<< Updated upstream
    return {
        "numericScore": numeric_score,
        "grade": grade,
        "materials": materials,
        "carbonFootprintKg": carbon_kg,
        "waterUsageLiters": water_l,
        "explanation": explanation,
        "used": "fallback",
    }

def ai_score(text: str) -> dict:
    """
    Calls Groq (Llama 3) with a structured prompt.
    Returns parsed JSON. Tries to be robust if the model adds extra text.
    """

    prompt = f"""
    IMPORTANT:
Output ONLY the final JSON described below.
DO NOT output category analysis, chain-of-thought, or reasoning in JSON format.

You are GreenChoice, an AI sustainability expert and product auditor.

Your job is to evaluate how environmentally sustainable a product is
and explain WHY in clear, simple language.

You will be given product text (title, description, maybe URL).
From that, you must infer the product type and materials/chemicals used.

First, silently (in your reasoning) identify which high-level category fits best:
- "clothing_textiles"      (clothes, shoes, bags, bedsheets, towels, etc.)
- "personal_care"          (shampoo, face wash, toothpaste, cosmetics, soap, lotion, etc.)
- "electronics"            (phones, laptops, headphones, appliances, gadgets, etc.)
- "household_cleaning"     (detergent, floor cleaner, dishwash, surface cleaners, etc.)
- "food_beverage"          (snacks, drinks, groceries, packaged food, supplements)
- "furniture_home"         (furniture, decor, bedding, kitchenware)
- "toys_baby"              (toys, baby products, diapers, kids care items)
- "generic_other"          (anything not covered above)

Then evaluate sustainability using these factors:

1) MATERIALS & CHEMICALS
   - POSITIVE: organic cotton, hemp, bamboo, linen, wool (ethically sourced),
     natural rubber/latex, glass, stainless steel, aluminum (when durable),
     refills, simple natural ingredients, sulfate-free, paraben-free,
     fragrance-free, low-toxicity formulations.
   - NEGATIVE: conventional polyester, nylon, acrylic, PVC, generic "plastic",
     disposable single-use items, heavy fossil-based materials,
     aggressive surfactants (SLS/SLES), parabens, phthalates, triclosan,
     unnecessary fragrance, strong solvents.

2) PACKAGING
   - POSITIVE: paper/cardboard, glass, metal, minimal packaging, refills.
   - NEGATIVE: lots of plastic, mixed-material packs (hard to recycle),
     single-use sachets or pods.

3) DURABILITY & REUSE
   - POSITIVE: reusable, long-life, repairable, refillable, concentrated products.
   - NEGATIVE: single-use, disposable, tiny sample sizes.

4) SPECIAL RULES BY CATEGORY:
   - clothing_textiles:
       • prioritize natural / organic fibers, low synthetic share
       • recycled polyester is better than virgin but still imperfect
   - personal_care:
       • be stricter on harmful chemicals & microplastics
       • reward "sulphate-free", "paraben-free", "SLS-free", "fragrance-free", etc.
   - electronics:
       • large screens, batteries, many materials → higher footprint
       • reward durability, repairability, energy efficiency
   - household_cleaning:
       • concentrates / refills / low-plastic packs are better
   - food_beverage:
       • plant-based, organic, minimally processed → better

SCORING:
- numericScore is from -10 (very harmful) to +10 (very eco-friendly).
- A grade: 8–10
- B grade: 5–7
- C grade: 2–4
- D grade: 0–1
- F grade: -10 to -1

Carbon & water estimates:
- carbonFootprintKg: 0.2 – 12 kg per item.
- waterUsageLiters: 50 – 3000 L per item.

OUTPUT FORMAT (IMPORTANT):
Respond ONLY with valid JSON, no comments, no markdown, no extra text.

Example:
{{
  "materials": ["cotton", "plastic packaging"],
  "numericScore": 5,
  "grade": "B",
  "carbonFootprintKg": 2.5,
  "waterUsageLiters": 1200,
  "explanation": "This T-shirt uses mostly cotton but also plastic-based polyester. The cotton is positive, but synthetic fibers and plastic packaging reduce recyclability, leading to a moderate score."
}}

Now analyze this product and return JSON only:

{text}
"""

    completion = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
    )
    content = completion.choices[0].message.content.strip()

 
    try:
        return json.loads(content)
    except Exception:
        json_blocks = content.split("\n\n")
        for block in reversed(json_blocks):
            block = block.strip()
            if block.startswith("{") and block.endswith("}"):
                try:
                    return json.loads(block)
                except:
                    pass
        raise
=======
def ai_score(text: str) -> dict:
    return assess(text)

>>>>>>> Stashed changes

@app.post("/classify")
def classify():
    """
    Lightweight AI-like category + gender classifier used by extension
    Does NOT change scoring logic. Only used to group similar products.
    """

    payload = request.get_json(silent=True) or {}

    text = " ".join([
        payload.get("title", ""),
        payload.get("breadcrumb", ""),
        payload.get("description", "")
    ]).lower()

    if not text.strip():
        return jsonify({"category": "unknown", "gender": "unisex"})

   
    try:
        prompt = f"""
        You will classify an e-commerce product.

        Text:
        {text}

        Decide:
        - best high-level category
        - gender (male / female / unisex)

        Categories allowed:
        - clothing_textiles
        - women_ethnic
        - footwear
        - electronics
        - accessories
        - beauty_personal_care
        - home_kitchen
        - food_beverage
        - toys
        - generic_other

        Output JSON only:

        {{
          "category": "...",
          "gender": "male/female/unisex"
        }}
        """

<<<<<<< Updated upstream
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
        )

        raw = completion.choices[0].message.content.strip()

        try:
            data = json.loads(raw)
            cat = data.get("category", "unknown")
            gen = data.get("gender", "unisex")
            return jsonify({"category": cat, "gender": gen})
        except Exception:
            pass

    except Exception:
        pass  # fail to heuristic fallback

=======
        raw = groq_json_completion(prompt)

        try:
            data = json.loads(raw)
            cat = data.get("category", "unknown")
            gen = data.get("gender", "unisex")
            return jsonify({"category": cat, "gender": gen})
        except Exception:
            pass

    except Exception:
        pass  # fail to heuristic fallback

>>>>>>> Stashed changes
    if any(x in text for x in ["saree", "lehenga", "anarkali", "salwar", "kurti"]):
        category = "women_ethnic"
    elif any(x in text for x in ["shirt", "tshirt", "dress", "jeans", "trouser", "hoodie", "top"]):
        category = "clothing_textiles"
    elif any(x in text for x in ["shoe", "sandal", "sneaker", "boot"]):
        category = "footwear"
    elif any(x in text for x in ["phone", "laptop", "earphone", "headphone", "smartwatch", "camera"]):
        category = "electronics"
    elif any(x in text for x in ["cream", "shampoo", "lipstick", "lotion", "soap"]):
        category = "beauty_personal_care"
    elif any(x in text for x in ["towel", "bottle", "pan", "cookware", "bedsheet", "pillow", "mattress"]):
        category = "home_kitchen"
    else:
        category = "generic_other"

    if any(x in text for x in ["women", "ladies", "girl", "female"]):
        gender = "female"
    elif any(x in text for x in ["men", "male", "boy"]):
        gender = "male"
    else:
        gender = "unisex"

    return jsonify({"category": category, "gender": gender})


def ai_score_alternatives(names: list[str]) -> list[dict]:
    """
    Fast multi-product scoring:
    Takes a list of product names (strings) and returns
    a list of { "name", "numericScore", "grade" } dicts.
    Only ONE Groq call for all products.
    """

<<<<<<< Updated upstream
    if not names:
        return []

    numbered_list = "\n".join(f"{i+1}. {n}" for i, n in enumerate(names))

    prompt = f"""
You are GreenChoice, an AI sustainability expert.

You will receive a numbered list of product names (titles). For EACH product,
estimate how eco-friendly it is based ONLY on the name (assume typical materials):

- Higher scores for: organic cotton, bamboo, hemp, linen, wool, recycled materials,
  eco-friendly / biodegradable / compostable, plant-based, low-plastic.
- Lower scores for: plastic, polyester, nylon, disposable, synthetic-heavy,
  fossil-fuel intensive, single-use items.

For each product, output:
- "name": exactly the original product name as given
- "numericScore": an integer from -10 (very bad) to +10 (very good)
- "grade": A, B, C, D, or F

SCORING:
- A: 8 to 10
- B: 5 to 7
- C: 2 to 4
- D: 0 to 1
- F: -10 to -1

IMPORTANT:
Return a JSON ARRAY only, no extra text, no explanations.
Example:
[
  {{"name": "Organic bamboo toothbrush", "numericScore": 9, "grade": "A"}},
  {{"name": "Plastic single-use razor", "numericScore": -4, "grade": "F"}}
]

Now score the following products:

{numbered_list}
"""

    completion = client.chat.completions.create(
        model="llama-3.1-8b-instant",   # make sure you're using a valid Groq model
        messages=[{"role": "user", "content": prompt}],
    )

    content = completion.choices[0].message.content.strip()

    try:
        return json.loads(content)
    except Exception:
        blocks = [b.strip() for b in content.split("\n\n") if b.strip()]
        for block in reversed(blocks):
            if block.startswith("[") and block.endswith("]"):
                try:
                    return json.loads(block)
                except Exception:
                    pass
        # if everything fails, let caller handle fallback
        raise

=======
>>>>>>> Stashed changes
@app.post("/analyze")
def analyze():
    """
    Analyze a single product:
    expects JSON { url, title, description } from the extension.
    """
    payload = request.get_json(silent=True) or {}
    url = payload.get("url", "") or ""
    title = payload.get("title", "") or ""
    description = payload.get("description", "") or ""

    text = "\n".join([title, description, str(payload.get("material") or "")])

    try:
        ai = ai_score(text)
        return jsonify({
            "numericScore": ai.get("numericScore"),
            "grade": ai.get("grade"),
            "materials": ai.get("materials", []),
            "carbonFootprintKg": ai.get("carbonFootprintKg"),
            "waterUsageLiters": ai.get("waterUsageLiters"),
            "explanation": ai.get("explanation"),
            "used": ai.get("used", "evidence_rubric"),
            "confidence": ai.get("confidence", "low"),
            "positiveFactors": ai.get("positiveFactors", []),
            "negativeFactors": ai.get("negativeFactors", []),
        })
    except Exception as e:
        print("AI failed, using fallback:", e, flush=True)
        fb = fallback_analysis(text)
        return jsonify(fb)

def ai_score_alternatives(names: list[str]) -> list[dict]:
<<<<<<< Updated upstream
    """
    Fast multi-product scoring:
    Takes a list of product names (strings) and returns
    a list of { "name", "numericScore", "grade" } dicts.
    Only ONE Groq call for all products.
    """

    if not names:
        return []


    numbered_list = "\n".join(f"{i+1}. {n}" for i, n in enumerate(names))

    prompt = f"""
You are GreenChoice, an AI sustainability expert.

You will receive a numbered list of product names (titles). For EACH product,
estimate how eco-friendly it is based ONLY on the name (assume typical materials):

- Higher scores for: organic cotton, bamboo, hemp, linen, wool, recycled materials,
  eco-friendly / biodegradable / compostable, plant-based, low-plastic.
- Lower scores for: plastic, polyester, nylon, disposable, synthetic-heavy,
  fossil-fuel intensive, single-use items.

For each product, output:
- "name": exactly the original product name as given
- "numericScore": an integer from -10 (very bad) to +10 (very good)
- "grade": A, B, C, D, or F

SCORING:
- A: 8 to 10
- B: 5 to 7
- C: 2 to 4
- D: 0 to 1
- F: -10 to -1

IMPORTANT:
- Return a JSON ARRAY only, no extra text, no explanations.
- JSON format example:
[
  {{"name": "Organic bamboo toothbrush", "numericScore": 9, "grade": "A"}},
  {{"name": "Plastic single-use razor", "numericScore": -4, "grade": "F"}}
]

Now score the following products:

{numbered_list}
"""

    completion = client.chat.completions.create(
        model="llama-3.1-8b-instant",   # fast Groq model
        messages=[{"role": "user", "content": prompt}],
    )

    content = completion.choices[0].message.content.strip()

    # Robust JSON parsing: try direct, then block-by-block (use last valid JSON)
    try:
        return json.loads(content)
    except Exception:
        blocks = [b.strip() for b in content.split("\n\n") if b.strip()]
        for block in reversed(blocks):
            if block.startswith("[") and block.endswith("]"):
                try:
                    return json.loads(block)
                except Exception:
                    pass
            if block.startswith("{") and block.endswith("}"):
                try:
                    single = json.loads(block)
                    if isinstance(single, dict):
                        return [single]
                except Exception:
                    pass
        # If everything fails, let caller fall back to heuristic
        raise

=======
    return [{"name": name, **assess(name)} for name in names]


>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
            price = (p.get("price") or "").strip()
=======
            price = str(p.get("price") or "").strip()
>>>>>>> Stashed changes
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

    results = []

    # Try bulk AI scoring once for all names 
    score_map = {}
    try:
        ai_list = [{"name": p["title"], **assess(p)} for p in normalized]
        for item in ai_list:
            n = item.get("name")
            if not n:
                continue
            score_map[n] = item
    except Exception as e:
        print("AI bulk failed for alternatives, using heuristic only:", e, flush=True)

    # Build final results, preserving URL/price from normalized list 
    for prod in normalized:
        name = prod["title"]
        url = prod["url"]
        price = prod["price"]

        ai_item = score_map.get(name)
        if ai_item:
            numeric_score = ai_item.get("numericScore")
            grade = ai_item.get("grade")
        else:
            numeric_score = compute_heuristic_score(name)
            grade = map_score_to_grade(numeric_score)

        results.append({
            "name": name,
            "url": url,
            "price": price,
            "numericScore": numeric_score,
            "grade": grade,
            "confidence": (ai_item or {}).get("confidence", "low"),
            "explanation": (ai_item or {}).get("explanation", ""),
            "positiveFactors": (ai_item or {}).get("positiveFactors", []),
            "negativeFactors": (ai_item or {}).get("negativeFactors", []),
            "materials": (ai_item or {}).get("materials", []),
        })

    #Sort best first (by numericScore)
    results.sort(key=lambda r: (bool(r.get("materials")), float(r.get("numericScore") or 0)), reverse=True)

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
<<<<<<< Updated upstream
            "rawPrice": raw_price,
            "price": price
=======
            "url": str(prod.get("url") or ""),
            "rawPrice": raw_price,
            "price": price,
            "description": str(prod.get("description") or ""),
            "material": str(prod.get("material") or ""),
>>>>>>> Stashed changes
        })

    if not clean_products:
        return jsonify({"ranked": [], "best": None})

    min_price = min(prices) if prices else None

    ranked = []
    for prod in clean_products:
        name = prod["name"]
        price = prod["price"]
        raw_price = prod["rawPrice"]

        #Sustainability score
        try:
<<<<<<< Updated upstream
            ai = ai_score(name)
=======
            ai = assess(prod)
>>>>>>> Stashed changes
            numeric = ai.get("numericScore")
        except Exception:
            numeric = compute_heuristic_score(name)

        try:
            numeric = float(numeric)
        except Exception:
            numeric = 0.0

<<<<<<< Updated upstream
        # Normalize sustainability score to 0..1.
        # Heuristic: -10..10 -> (x+10)/20.
        # AI often returns 0..10 -> x/10.
        if numeric < 0:
            sustain_norm = (numeric + 10.0) / 20.0
        else:
            sustain_norm = numeric / 10.0 if numeric <= 10 else (numeric / 20.0)

        sustain_norm = clamp(sustain_norm, 0.0, 1.0)

        #Price normalization 
        if price and min_price:
            price_norm = min_price / price  # cheapest gets 1.0
        elif min_price is None:
            price_norm = 0.5  # neutral if no prices available
        else:
            price_norm = 0.0  # missing price while others exist

        price_norm = clamp(price_norm, 0.0, 1.0)

=======
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

>>>>>>> Stashed changes
        #Weighted combined value score 
        value_index = (0.65 * sustain_norm) + (0.35 * price_norm)
        value_index = clamp(value_index, 0.0, 1.0)

        ranked.append({
            "name": name,
            "url": str(prod.get("url") or ""),
            "rawPrice": raw_price,
            "price": price,
            "numericScore": numeric,
<<<<<<< Updated upstream
=======
            "grade": grade_for(numeric),
            "confidence": ai.get("confidence", "low"),
            "explanation": ai.get("explanation", ""),
>>>>>>> Stashed changes
            "sustainNorm": round(float(sustain_norm), 4),
            "priceNorm": round(float(price_norm), 4),
            "valueIndex": round(float(value_index), 6),
            "valueScore": round(float(value_index) * 100.0, 1),
        })

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

