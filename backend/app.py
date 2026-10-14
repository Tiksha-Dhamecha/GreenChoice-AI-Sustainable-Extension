import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from groq import Groq
from database import init_db, update_order_status, get_user, create_user

load_dotenv()

app = Flask(__name__)
CORS(app)  
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # 2 MB limit
with app.app_context():
    init_db()

# Groq client
# client = Groq(api_key=os.getenv("GROQ_API_KEY"))
# Groq + GPT-OSS configuration
MODEL_NAME = os.getenv(
    "GROQ_MODEL",
    "openai/gpt-oss-20b"
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise RuntimeError(
        "GROQ_API_KEY is missing. Check your .env file."
    )

client = Groq(api_key=GROQ_API_KEY)

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

CLASSIFICATION_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {
            "type": "string",
            "enum": [
                "clothing_textiles",
                "women_ethnic",
                "footwear",
                "electronics",
                "accessories",
                "beauty_personal_care",
                "home_kitchen",
                "food_beverage",
                "toys",
                "generic_other"
            ]
        },
        "gender": {
            "type": "string",
            "enum": ["male", "female", "unisex"]
        }
    },
    "required": ["category", "gender"],
    "additionalProperties": False
}
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


def map_score_to_grade(score: int) -> str:
    if score >= 8:
        return "A"
    if score >= 5:
        return "B"
    if score >= 2:
        return "C"
    if score >= 0:
        return "D"
    return "F"


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
    materials = detect_materials(text)
    numeric_score = compute_heuristic_score(text)
    grade = map_score_to_grade(numeric_score)
    explanation = build_explanation(materials, numeric_score)

    carbon_kg = clamp(abs(numeric_score) * 0.8 + 1, 0.2, 12)
    water_l = clamp(abs(numeric_score) * 150 + 200, 50, 3000)

    return {
        "numericScore": numeric_score,
        "grade": grade,
        "materials": materials,
        "carbonFootprintKg": carbon_kg,
        "waterUsageLiters": water_l,
        "explanation": explanation,
        "used": "fallback",
    }
SCORE_SCHEMA = {
    "type": "object",
    "properties": {
        "numericScore": {
            "type": "integer"
        },
        "grade": {
            "type": "string",
            "enum": ["A", "B", "C", "D", "F"]
        },
        "materials": {
            "type": "array",
            "items": {
                "type": "string"
            }
        },
        "carbonFootprintKg": {
            "type": "number"
        },
        "waterUsageLiters": {
            "type": "number"
        },
        "explanation": {
            "type": "string"
        }
    },
    "required": [
        "numericScore",
        "grade",
        "materials",
        "carbonFootprintKg",
        "waterUsageLiters",
        "explanation"
    ],
    "additionalProperties": False
}
ALTERNATIVES_SCHEMA = {
    "type": "object",
    "properties": {
        "alternatives": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "numericScore": {"type": "integer"},
                    "grade": {
                        "type": "string",
                        "enum": ["A", "B", "C", "D", "F"]
                    }
                },
                "required": [
                    "index",
                    "numericScore",
                    "grade"
                ],
                "additionalProperties": False
            }
        }
    },
    "required": ["alternatives"],
    "additionalProperties": False
}
def call_groq_json(
    prompt: str,
    schema_name: str,
    schema: dict,
    max_completion_tokens: int = 1500
) -> dict:
    """
    Generate schema-constrained JSON using Groq GPT-OSS.
    Raises an exception if the request or parsing fails.
    """

    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": schema_name,
                "strict": True,
                "schema": schema
            }
        },
        reasoning_format="hidden",
        reasoning_effort="low",
        max_completion_tokens=max_completion_tokens
    )

    content = response.choices[0].message.content

    if not content:
        raise ValueError("GPT-OSS returned an empty response.")

    data = json.loads(content)

    if not isinstance(data, dict):
        raise ValueError(
            "GPT-OSS did not return a JSON object."
        )

    return data
def ai_score(text: str) -> dict:
    """
    Calls Groq ("openai/gpt-oss-20b") with a structured prompt.
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

    # completion = client.chat.completions.create(
    #     model="openai/gpt-oss-20b",
    #     messages=[{"role": "user", "content": prompt}],
    # )
    # content = completion.choices[0].message.content.strip()

 
    # try:
    #     return json.loads(content)
    # except Exception:
    #     json_blocks = content.split("\n\n")
    #     for block in reversed(json_blocks):
    #         block = block.strip()
    #         if block.startswith("{") and block.endswith("}"):
    #             try:
    #                 return json.loads(block)
    #             except:
    #                 pass
    #     raise
    data = call_groq_json(
        prompt=prompt,
        schema_name="greenchoice_product_score",
        schema=SCORE_SCHEMA,
        max_completion_tokens=1500
    )

    score = int(round(float(data["numericScore"])))
    score = int(clamp(score, -10, 10))

    data["numericScore"] = score
    data["grade"] = map_score_to_grade(score)

    data["materials"] = [
        str(material)
        for material in data["materials"]
        if str(material).strip()
    ]

    data["carbonFootprintKg"] = round(
        clamp(float(data["carbonFootprintKg"]), 0.2, 12),
        2
    )

    data["waterUsageLiters"] = int(round(
        clamp(float(data["waterUsageLiters"]), 50, 3000)
    ))

    data["explanation"] = str(data["explanation"])

    return data


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

        # completion = client.chat.completions.create(
        #     model="openai/gpt-oss-20b",
        #     messages=[{"role": "user", "content": prompt}],
        # )

        # raw = completion.choices[0].message.content.strip()

        # try:
        #     data = json.loads(raw)
        #     cat = data.get("category", "unknown")
        #     gen = data.get("gender", "unisex")
        #     return jsonify({"category": cat, "gender": gen})
        # except Exception:
        #     pass
        data = call_groq_json(
            prompt=prompt,
            schema_name="greenchoice_product_classification",
            schema=CLASSIFICATION_SCHEMA,
            max_completion_tokens=300
        )

        return jsonify({
            "category": data["category"],
            "gender": data["gender"]
        })
        

    # except Exception:
    #     pass  # fail to heuristic fallback
    except Exception as e:
        print(
            "GPT-OSS classification failed; using heuristics:",
            repr(e),
            flush=True
        )
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

    text = "\n".join([title, description, url])

    try:
        ai = ai_score(text)
        return jsonify({
            "numericScore": ai.get("numericScore"),
            "grade": ai.get("grade"),
            "materials": ai.get("materials", []),
            "carbonFootprintKg": ai.get("carbonFootprintKg"),
            "waterUsageLiters": ai.get("waterUsageLiters"),
            "explanation": ai.get("explanation"),
            "used": "AI",
        })
    except Exception as e:
        print("AI failed, using fallback:", e, flush=True)
        fb = fallback_analysis(text)
        return jsonify(fb)

def score_alternative_title(title: str, model_score=None) -> int:
    """
    Calibrate title-only AI scores against visible evidence.
    Missing sustainability information must not earn an A grade.
    """

    text = (title or "").lower()

    weights = {
        "certified organic cotton": 6,
        "certified organic": 5,
        "organic cotton": 4,
        "recycled polyester": 1,
        "recycled plastic": 1,
        "stainless steel": 2,
        "biodegradable": 4,
        "compostable": 4,
        "reusable": 2,
        "refillable": 2,
        "repairable": 2,
        "energy efficient": 2,
        "bamboo": 3,
        "hemp": 3,
        "linen": 3,
        "organic": 3,
        "recycled": 3,
        "durable": 1,
        "cotton": 2,
        "glass": 1,
        "steel": 1,
        "aluminum": 1,
        "aluminium": 1,
        "single-use": -4,
        "single use": -4,
        "disposable": -4,
        "polyester": -3,
        "microfiber": -3,
        "nylon": -3,
        "acrylic": -3,
        "pvc": -4,
        "plastic": -2,
    }

    # Count the longest matching phrase to avoid double-counting
    # phrases such as "stainless steel" and "steel".
    evidence = 0
    matched = []

    for term, weight in sorted(
        weights.items(),
        key=lambda item: len(item[0]),
        reverse=True
    ):
        if term in text and not any(
            term in existing for existing in matched
        ):
            evidence += weight
            matched.append(term)

    evidence = int(clamp(evidence, -10, 10))

    if model_score is None:
        return evidence

    try:
        ai_score = float(clamp(float(model_score), -10, 10))
    except (TypeError, ValueError):
        return evidence

    # Give explicit title evidence 80% weight and AI 20%.
    combined = round(0.20 * ai_score + 0.80 * evidence)

    # Unknown sustainability properties cannot earn a high score
    # solely because the AI guessed.
    if evidence == 0:
        combined = clamp(combined, -2, 2)

    return int(clamp(combined, -10, 10))

def ai_score_alternatives(names: list[str]) -> list[dict]:
    if not names:
        return []

    clean_names = [str(name).strip() for name in names]

    numbered_list = "\n".join(
        f"{i + 1}. {name}"
        for i, name in enumerate(clean_names)
    )

    prompt = f"""
You are GreenChoice, a sustainability product evaluator.

Score each product based on the supplied product name only.
Do not invent certifications or product details.

Higher scores: clearly indicated organic, recycled, reusable,
or durable products.
Lower scores: clearly indicated disposable products, single-use
plastic, or harmful materials.
When evidence is limited, use a cautious score.

Grades:
A = 8 to 10
B = 5 to 7
C = 2 to 4
D = 0 to 1
F = -10 to -1

Return an alternatives array. Each item must contain:
- index: original 1-based product number
- numericScore: integer from -10 to +10
- grade: A, B, C, D, or F

Score every input product exactly once.

Products:
{numbered_list}
"""

    data = call_groq_json(
        prompt=prompt,
        schema_name="greenchoice_alternative_scores",
        schema=ALTERNATIVES_SCHEMA,
        max_completion_tokens=1600
    )

    by_index = {}

    for item in data["alternatives"]:
        index = int(item["index"])

        if not 1 <= index <= len(clean_names):
            continue

        score = int(round(float(item["numericScore"])))
        score = int(clamp(score, -10, 10))

        by_index[index] = {
            "name": clean_names[index - 1],
            "numericScore": score,
            "grade": map_score_to_grade(score)
        }

    return [
        by_index[index]
        for index in range(1, len(clean_names) + 1)
        if index in by_index
    ]
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

    for p in products[:8]:   # hard limit for speed
        if isinstance(p, dict):
       
            title = (
                (p.get("title") or "").strip()
                or (p.get("name") or "").strip()
                or (p.get("label") or "").strip()
            )
            url = (p.get("url") or "").strip()
            # price = (p.get("price") or "").strip()
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
        })
        names.append(title)


    if not names:
        return jsonify({"alternatives": []})

    results = []

    # Try bulk AI scoring once for all names 
    score_map = {}
    try:
        ai_list = ai_score_alternatives(names)  # ONE Groq call
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

        # ai_item = score_map.get(name)
        # if ai_item:
        #     numeric_score = ai_item.get("numericScore")
        #     grade = ai_item.get("grade")
        # else:
        #     numeric_score = compute_heuristic_score(name)
        #     grade = map_score_to_grade(numeric_score)
        ai_item = score_map.get(name)

        model_score = (
            ai_item.get("numericScore")
            if ai_item else None
        )

        numeric_score = score_alternative_title(
            name,
            model_score
        )

        grade = map_score_to_grade(numeric_score)

        results.append({
            "name": name,
            "url": url,
            "price": price,
            "numericScore": numeric_score,
            "grade": grade,
        })

    #Sort best first (by numericScore)
    results.sort(key=lambda r: (r.get("numericScore") or 0), reverse=True)

    return jsonify({"alternatives": results})

# Compare products by cost + sustainability
@app.post("/compare_products")
# def compare_products():
#     """
#     Compare products on a combined Cost + Sustainability basis.

#     Output fields (per product):
#       - numericScore: sustainability score from AI/heuristic (roughly -10..10 or 0..10 depending on model)
#       - sustainNorm: numericScore normalized to 0..1
#       - priceNorm: relative affordability score 0..1 (cheaper => higher)
#       - valueIndex: weighted blend 0..1
#       - valueScore: valueIndex mapped to 0..100 (for UI)
#     """
#     payload = request.get_json(silent=True) or {}
#     products = payload.get("products", [])

#     if not isinstance(products, list) or not products:
#         return jsonify({"error": "products array required"}), 400

#     #Pre-read prices to compute min price for normalization
#     clean_products = []
#     prices = []
#     for prod in products:
#         name = str(prod.get("name") or "").strip()
#         if not name:
#             continue

#         raw_price = prod.get("rawPrice", "")
#         price = prod.get("price")

#         parsed_price = None
#         try:
#             parsed_price = float(price)
#         except Exception:
#             parsed_price = None

#         if (parsed_price is None) and raw_price:
#             # e.g. "₹999", "Rs. 1,299", "1,299"
#             try:
#                 import re
#                 m = re.findall(r"[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?", str(raw_price))
#                 if m:
#                     parsed_price = float(m[0].replace(",", ""))
#             except Exception:
#                 parsed_price = None

#         if parsed_price is not None and parsed_price <= 0:
#             parsed_price = None

#         price = parsed_price

#         # If UI price text is missing but numeric price exists, reconstruct a readable ₹ price.
#         if (not raw_price) and price:
#             # no decimals for typical apparel pricing
#             try:
#                 raw_price = f"₹{int(round(price)):,}"
#             except Exception:
#                 raw_price = f"₹{price}"

#         if price:
#             prices.append(price)

#         clean_products.append({
#             "name": name,
#             "rawPrice": raw_price,
#             "price": price
#         })

#     if not clean_products:
#         return jsonify({"ranked": [], "best": None})

#     min_price = min(prices) if prices else None

#     ranked = []
#     # Score all products in a single model call.
# score_map = {}

# try:
#     product_names = [
#         product["name"]
#         for product in clean_products
#     ]

#     bulk_results = ai_score_alternatives(product_names)

#     score_map = {
#         item["name"]: item["numericScore"]
#         for item in bulk_results
#         if item.get("name")
#         and item.get("numericScore") is not None
#     }

# except Exception as e:
#     print(
#         "Bulk GPT-OSS comparison failed:",
#         repr(e),
#         flush=True
#     )
#     for prod in clean_products:
#         name = prod["name"]
#         price = prod["price"]
#         raw_price = prod["rawPrice"]

#         #Sustainability score
#         # try:
#         #     ai = ai_score(name)
#         #     numeric = ai.get("numericScore")
#         # except Exception:
#         #     numeric = compute_heuristic_score(name)

#         # try:
#         #     numeric = float(numeric)
#         # except Exception:
#         #     numeric = 0.0
#         numeric = score_map.get(
#             name,
#             compute_heuristic_score(name)
#         )

#         try:
#             numeric = float(numeric)
#         except (TypeError, ValueError):
#             numeric = float(compute_heuristic_score(name))

#         numeric = clamp(numeric, -10, 10)

#         # Normalize sustainability score to 0..1.
#         # Heuristic: -10..10 -> (x+10)/20.
#         # AI often returns 0..10 -> x/10.
#         # if numeric < 0:
#         #     sustain_norm = (numeric + 10.0) / 20.0
#         # else:
#         #     sustain_norm = numeric / 10.0 if numeric <= 10 else (numeric / 20.0)
        

#         # sustain_norm = clamp(sustain_norm, 0.0, 1.0)
#         sustain_norm = (numeric + 10.0) / 20.0

#         sustain_norm = clamp(
#             sustain_norm,
#             0.0,
#             1.0
#         )

#         #Price normalization 
#         if price and min_price:
#             price_norm = min_price / price  # cheapest gets 1.0
#         elif min_price is None:
#             price_norm = 0.5  # neutral if no prices available
#         else:
#             price_norm = 0.0  # missing price while others exist

#         price_norm = clamp(price_norm, 0.0, 1.0)

#         #Weighted combined value score 
#         value_index = (0.65 * sustain_norm) + (0.35 * price_norm)
#         value_index = clamp(value_index, 0.0, 1.0)

#         ranked.append({
#             "name": name,
#             "rawPrice": raw_price,
#             "price": price,
#             "numericScore": numeric,
#             "sustainNorm": round(float(sustain_norm), 4),
#             "priceNorm": round(float(price_norm), 4),
#             "valueIndex": round(float(value_index), 6),
#             "valueScore": round(float(value_index) * 100.0, 1),
#         })

#     ranked.sort(key=lambda x: x["valueIndex"], reverse=True)

#     return jsonify({
#         "ranked": ranked,
#         "best": ranked[0] if ranked else None
#     })


@app.post("/compare_products")
def compare_products():
    """
    Compare products based on sustainability and affordability.

    Returns:
        ranked: Products sorted by valueIndex, highest first.
        best: The highest-ranked product.
    """

    payload = request.get_json(silent=True) or {}
    products = payload.get("products", [])

    if not isinstance(products, list) or not products:
        return jsonify({"error": "products array required"}), 400

    # --------------------------------------------------
    # STEP 1: Clean product names and extract prices
    # --------------------------------------------------
    clean_products = []
    prices = []

    for prod in products:
        if not isinstance(prod, dict):
            continue

        name = str(prod.get("name") or "").strip()

        if not name:
            continue

        raw_price = prod.get("rawPrice") or ""
        price = prod.get("price")
        try:
            parsed_price = float(price)
        except (TypeError, ValueError):
            parsed_price = None

        # Extract price from text if necessary.
        if parsed_price is None and raw_price:
            try:
                import re

                matches = re.findall(
                    r"[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?",
                    str(raw_price)
                )

                if matches:
                    parsed_price = float(
                        matches[0].replace(",", "")
                    )

            except (TypeError, ValueError):
                parsed_price = None

        # Ignore invalid or non-positive prices.
        if parsed_price is not None and parsed_price <= 0:
            parsed_price = None

        price = parsed_price

        # Construct a readable price if necessary.
        if not raw_price and price is not None:
            raw_price = f"₹{price:,.0f}"

        if price is not None:
            prices.append(price)

        clean_products.append({
            "name": name,
            "rawPrice": str(raw_price),
            "price": price
        })

    if not clean_products:
        return jsonify({
            "ranked": [],
            "best": None
        })

    min_price = min(prices) if prices else None

    # --------------------------------------------------
    # STEP 2: Score all products in one AI request
    # --------------------------------------------------
    score_map = {}

    try:
        product_names = [
            product["name"]
            for product in clean_products
        ]

        bulk_results = ai_score_alternatives(product_names)

        score_map = {
            item["name"]: item["numericScore"]
            for item in bulk_results
            if isinstance(item, dict)
            and item.get("name")
            and item.get("numericScore") is not None
        }

        print(
            f"GPT-OSS scored {len(score_map)} products.",
            flush=True
        )

    except Exception as e:
        print(
            "Bulk GPT-OSS comparison failed; "
            "using heuristic scores:",
            repr(e),
            flush=True
        )

    # --------------------------------------------------
    # STEP 3: Calculate sustainability and value scores
    # --------------------------------------------------
    ranked = []

    for prod in clean_products:
        name = prod["name"]
        price = prod["price"]
        raw_price = prod["rawPrice"]

        # Use AI score when available; otherwise use fallback.
        numeric = score_map.get(name)

        if numeric is None:
            numeric = compute_heuristic_score(name)

        try:
            numeric = float(numeric)
        except (TypeError, ValueError):
            numeric = float(
                compute_heuristic_score(name)
            )

        numeric = clamp(numeric, -10, 10)

        # Normalize sustainability: -10..+10 becomes 0..1.
        sustain_norm = (numeric + 10.0) / 20.0

        sustain_norm = clamp(
            sustain_norm,
            0.0,
            1.0
        )

        # Normalize price: cheaper products receive higher scores.
        if price is not None and min_price is not None:
            price_norm = min_price / price
        elif min_price is None:
            price_norm = 0.5
        else:
            price_norm = 0.0

        price_norm = clamp(
            price_norm,
            0.0,
            1.0
        )

        # Combine sustainability (65%) and affordability (35%).
        value_index = (
            0.65 * sustain_norm
            + 0.35 * price_norm
        )

        value_index = clamp(
            value_index,
            0.0,
            1.0
        )

        ranked.append({
            "name": name,
            "rawPrice": raw_price,
            "price": price,
            "numericScore": numeric,
            "sustainNorm": round(
                float(sustain_norm), 4
            ),
            "priceNorm": round(
                float(price_norm), 4
            ),
            "valueIndex": round(
                float(value_index), 6
            ),
            "valueScore": round(
                float(value_index) * 100.0, 1
            )
        })

    # --------------------------------------------------
    # STEP 4: Rank products and identify the best one
    # --------------------------------------------------
    ranked.sort(
        key=lambda item: item["valueIndex"],
        reverse=True
    )

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

