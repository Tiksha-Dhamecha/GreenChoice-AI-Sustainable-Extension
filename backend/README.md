# GreenChoice Backend (Python Version)

This is the **Python/Flask** backend for the GreenChoice browser extension.

## Setup

1. Create virtual environment (optional but recommended):

```bash
cd backend
python -m venv venv
 #Windows:
venv\Scripts\activate
 #Linux / macOS: 
 source venv/bin/activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Copy `.env.example` to `.env` and set:

```env
Groq_API_KEY=your_api_key_here
PORT=5000
```

4. Run the server:

```bash
python app.py
```

The API will be available at `http://localhost:5000`.

- `POST /analyze`
- `POST /alternatives`
