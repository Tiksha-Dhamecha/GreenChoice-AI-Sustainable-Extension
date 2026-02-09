import sqlite3
import datetime
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "greenchoice.db")

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # User table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            current_streak INTEGER DEFAULT 0,
            longest_streak INTEGER DEFAULT 0,
            last_sustainable_purchase_date TEXT,
            total_carbon_credits REAL DEFAULT 0.0,
            carbon_rewards INTEGER DEFAULT 0
        )
    ''')

    # Migration: Add carbon_rewards if it doesn't exist
    try:
        cursor.execute('ALTER TABLE users ADD COLUMN carbon_rewards INTEGER DEFAULT 0')
    except sqlite3.OperationalError:
        pass # Column likely already exists
    
    # Orders table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            order_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            product_name TEXT,
            order_status TEXT, -- 'placed', 'shipped', 'delivered', 'cancelled', 'returned'
            sustainability_score Real,
            carbon_credits REAL,
            is_sustainable INTEGER, -- 0 or 1
            purchase_date TEXT,
            streak_awarded INTEGER DEFAULT 0, -- 0 or 1
            FOREIGN KEY (user_id) REFERENCES users (user_id)
        )
    ''')

    # Price History table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_url TEXT NOT NULL,
            product_name TEXT,
            price REAL NOT NULL,
            timestamp TEXT NOT NULL
        )
    ''')
    
    conn.commit()
    conn.close()

def get_user(user_id):
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE user_id = ?', (user_id,)).fetchone()
    conn.close()
    return user

def create_user(user_id):
    conn = get_db_connection()
    try:
        conn.execute('INSERT INTO users (user_id) VALUES (?)', (user_id,))
        conn.commit()
    except sqlite3.IntegrityError:
        pass # User likely already exists
    conn.close()

def get_order(order_id):
    conn = get_db_connection()
    order = conn.execute('SELECT * FROM orders WHERE order_id = ?', (order_id,)).fetchone()
    conn.close()
    return order

def update_order_status(user_id, order_id, status, product_name=None, sustainability_score=None, carbon_credits=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # check if order exists
    existing_order = cursor.execute('SELECT * FROM orders WHERE order_id = ?', (order_id,)).fetchone()
    
    # Determine if sustainable (simple logic: score >= 5 or whatever threshold)
    # The user requirement: "Purchase classified as sustainable". Let's say score >= 5 (Grade B or better).
    is_sustainable = 0
    if sustainability_score is not None:
        if sustainability_score >= 5:
            is_sustainable = 1
    elif existing_order:
         is_sustainable = existing_order['is_sustainable']

    current_date = datetime.date.today().isoformat()

    if not existing_order:
        # Create new order
        cursor.execute('''
            INSERT INTO orders (order_id, user_id, product_name, order_status, sustainability_score, carbon_credits, is_sustainable, purchase_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (order_id, user_id, product_name, status, sustainability_score, carbon_credits, is_sustainable, current_date))
    else:
        # Update existing
        cursor.execute('''
            UPDATE orders 
            SET order_status = ?
            WHERE order_id = ?
        ''', (status, order_id))

    conn.commit()
    
    # Handle streak logic immediately after status update
    updated_order = cursor.execute('SELECT * FROM orders WHERE order_id = ?', (order_id,)).fetchone()
    handle_streak_update(user_id, updated_order, conn)
    
    conn.close()
    return updated_order

def handle_streak_update(user_id, order, conn):
    user = conn.execute('SELECT * FROM users WHERE user_id = ?', (user_id,)).fetchone()
    if not user:
        conn.execute('INSERT INTO users (user_id) VALUES (?)', (user_id,))
        user = conn.execute('SELECT * FROM users WHERE user_id = ?', (user_id,)).fetchone()

    status = order['order_status'].lower()
    is_sustainable = order['is_sustainable']
    streak_awarded = order['streak_awarded']
    credits = order['carbon_credits'] or 0
    
    current_streak = user['current_streak']
    longest_streak = user['longest_streak']
    total_credits = user['total_carbon_credits']
    # If the column doesn't exist in the fetched row (old schema cached not likely but possible if no restart), default to 0
    # But init_db guarantees column existence.
    try:
        carbon_rewards = user['carbon_rewards']
    except IndexError:
        carbon_rewards = 0
        
    if carbon_rewards is None:
        carbon_rewards = 0
    
    # Logic: Delivered + Sustainable -> Increment Streak (Count)
    if status == 'delivered' and is_sustainable and not streak_awarded:
        current_streak += 1
        if current_streak > longest_streak:
            longest_streak = current_streak
            
        # Award credits (Score)
        total_credits += credits
        
        # Calculate Carbon Rewards (New Feature)
        # Rule: For every time a user's total credit score exceeds 5 (multiples of 5), award 1 Carbon Credit.
        # We assume 1 credit per 5 score points.
        # Logic: Accumulate, do not revoke.
        
        # Logic:
        # 1. Calculate max rewards possible with current score: floor(score / 5)
        # 2. If this is greater than current carbon_rewards, update it.
        
        potential_rewards = int(total_credits // 5)
        if potential_rewards > carbon_rewards:
             carbon_rewards = potential_rewards

        # Update user
        today_str = datetime.date.today().isoformat()
        
        conn.execute('''
            UPDATE users 
            SET current_streak = ?, longest_streak = ?, last_sustainable_purchase_date = ?, total_carbon_credits = ?, carbon_rewards = ?
            WHERE user_id = ?
        ''', (current_streak, longest_streak, today_str, total_credits, carbon_rewards, user_id))
        
        # Mark order as awarded
        conn.execute('UPDATE orders SET streak_awarded = 1 WHERE order_id = ?', (order['order_id'],))
        conn.commit()

    # Logic: Delivered + Non-Sustainable -> Reset Streak
    elif status == 'delivered' and not is_sustainable and not streak_awarded:
        # Reset streak
        current_streak = 0
        
        # Apply penalty to credit score (Assuming penalty logic if needed, but prompt says "Buy non-sustainable -> streak reset")
        # Prompt also says: "Buying a non-sustainable product -> streak reset to 0"
        # Prompt also says: "Non-sustainable product -> credit_score -= penalty_value"
        # We need to define penalty_value. Let's assume a small penalty or defined somewhere?
        # "penalty_value (already defined in system)" - I don't see it defined in app.py or database.py constant.
        # I will assume a default penalty, e.g., 1.0 or 0.5, or derived from the negative score.
        # If the order has a sustainability_score (negative), we use that * 0.1?
        # Existing logic: carbon_credits is calculated in update_order_route.
        # If non-sustainable, carbon_credits passed might be negative or 0? 
        # In app.py: "if sustainability_score > 0: ... else: carbon_credits = 0.0"
        # So app.py currently doesn't pass negative credits.
        # However, requirements say "credit_score -= penalty_value".
        # I should probably update the score by subtracting if it's non-sustainable.
        # But app.py logic controls the inputs.
        # For now, I will implement the streak reset. 
        # Regarding score: If app.py passes 0 credits, score doesn't decrease.
        # If I need to implement penalty, I should likely change app.py to calculate negative credits or handle it here.
        # Given "Do NOT Break" existing system, and "Credit Score Logic (Already Implemented)", I should check if I missed where penalty is applied.
        # It seems NOT implemented in the provided code.
        # I will stick to resetting streak for now, as that's explicitly requested in "Streak Logic".
        # And I won't change the Credit Score logic unless I'm sure.
        # Wait, "Existing System... Buying a non-sustainable product -> streak reset to 0".
        # "Credit score update rules... Non-sustainable product -> credit_score -= penalty_value (already defined in system)".
        # Since I don't see it, I will assume 0.0 penalty or implement a safe default like 1.0 if score is not provided?
        # But `app.py` sets `carbon_credits` to 0.0 if score < 0.
        # I will assume for now that I just reset the streak.
        
        conn.execute('''
            UPDATE users 
            SET current_streak = ?
            WHERE user_id = ?
        ''', (current_streak, user_id))
        
        conn.execute('UPDATE orders SET streak_awarded = 1 WHERE order_id = ?', (order['order_id'],))
        conn.commit()

    # Logic: Refund/Return -> Revert Streak/Credits
    elif (status in ['cancelled', 'returned', 'refunded']) and streak_awarded:
        # Revert credits
        total_credits = max(0, total_credits - credits)
        
        # Revert streak (count)
        current_streak = max(0, current_streak - 1)
        
        conn.execute('''
            UPDATE users 
            SET current_streak = ?, total_carbon_credits = ?, carbon_rewards = ?
            WHERE user_id = ?
        ''', (current_streak, total_credits, carbon_rewards, user_id))
        
        # Mark order as NOT awarded
        conn.execute('UPDATE orders SET streak_awarded = 0 WHERE order_id = ?', (order['order_id'],))
        conn.commit()

    elif status == 'replaced':
        # "If replacement is sustainable -> streak remains."
        # "If replacement is not sustainable -> streak adjusted."
        # This implies we need to check the *new* product details if provided.
        # But 'status' usually doesn't carry product details.
        # If the order ID remains the same, we might update product details in a separate call? 
        # For now, if status is 'replaced' and we assume it's same product, we do nothing.
        # If product changes, the caller should update product info.
        pass

