import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from groq import Groq

# -----------------------------
# Setup
# -----------------------------
load_dotenv()

app = Flask(__name__)
CORS(app)  # Allow all origins; customize if needed
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # 2 MB limit

# Groq client (reads GROQ_API_KEY from .env)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# -----------------------------
# Heuristic helpers (fallback)
# -----------------------------

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

# Weighted materials / keywords (fallback heuristic)
MATERIAL_WEIGHTS = {
    # strong positives
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

    # mild positive (better than synthetics, but not as good as organic)
    "cotton": +2,
    "egyptian cotton": +2,
    "wool": +1,
    "silk": +1,

    # negatives
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

    # generic "recycled" without more detail
    if "recycled" in lower and "recycled " not in lower:
        score += 2

    # clamp to [-10, +10]
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

    # Basic sentiment based on score
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

    # Extra hints based on specific materials
    lower_materials = " ".join(materials).lower() if materials else ""

    if any(x in lower_materials for x in ["bamboo", "hemp", "organic", "recycled", "compostable", "biodegradable"]):
        parts.append("The presence of natural or recycled materials is a positive sign.")
    if any(x in lower_materials for x in ["plastic", "polyester", "nylon", "synthetic"]):
        parts.append("However, plastic or synthetic components can increase carbon footprint and reduce recyclability.")

    return " ".join(parts).strip()


def clamp(value, min_value, max_value):
    return max(min_value, min(max_value, value))


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

# -----------------------------
# Groq AI scoring
# -----------------------------


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

    # Robust JSON extraction: if model ever wraps JSON with other text
    try:
        return json.loads(content)
    except Exception:
        # start = content.find("{")
        # end = content.rfind("}")
        # if start != -1 and end != -1 and end > start:
        #     try:
        #         return json.loads(content[start:end + 1])
        #     except Exception as e2:
        #         print("JSON parse failed after trimming:", e2, "content:", content, flush=True)
        # # give up → let caller fall back
        json_blocks = content.split("\n\n")
        for block in reversed(json_blocks):
            block = block.strip()
            if block.startswith("{") and block.endswith("}"):
                try:
                    return json.loads(block)
                except:
                    pass
        raise

# -----------------------------
# Routes
# -----------------------------

def ai_score_alternatives(names: list[str]) -> list[dict]:
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

    # Robust JSON parsing: try direct, then block-by-block
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

def ai_score_alternatives(names: list[str]) -> list[dict]:
    """
    Fast multi-product scoring:
    Takes a list of product names (strings) and returns
    a list of { "name", "numericScore", "grade" } dicts.
    Only ONE Groq call for all products.
    """

    if not names:
        return []

    # Build a numbered list for the prompt
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

    # --- 1) Normalize input into a clean list of product objects ---
    normalized = []
    names = []

    # for p in products[:8]:   # hard limit for speed
    #     if isinstance(p, dict):
    #         title = (
    #             p.get("title")
    #             or p.get("name")
    #             or p.get("label")
    #             or p.get("url")
    #             or "Unknown product"
    #         )
    #         url = p.get("url") or ""
    #         price = p.get("price") or ""
    #     else:
    #         title = str(p).strip()
    #         url = ""
    #         price = ""

    #     if not title:
    #         continue

    #     normalized.append({
    #         "title": title,
    #         "url": url,
    #         "price": price,
    #     })
    #     names.append(title)
    for p in products[:8]:   # hard limit for speed
        if isinstance(p, dict):
        # only use real text fields for title
            title = (
                (p.get("title") or "").strip()
                or (p.get("name") or "").strip()
                or (p.get("label") or "").strip()
            )
            url = (p.get("url") or "").strip()
            price = (p.get("price") or "").strip()
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

    # --- 2) Try bulk AI scoring once for all names ---
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

    # --- 3) Build final results, preserving URL/price from normalized list ---
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
        })

    # --- 4) Sort best first (by numericScore) ---
    results.sort(key=lambda r: (r.get("numericScore") or 0), reverse=True)

    return jsonify({"alternatives": results})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
