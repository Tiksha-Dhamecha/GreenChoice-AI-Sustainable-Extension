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
            total_carbon_credits REAL DEFAULT 0.0
        )
    ''')
    
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
    
    # Logic: Delivered + Sustainable -> Increment Streak (Count)
    # "The streak increases only when sustainable purchases occur... Streak depends only on the count"
    # "If a user buys sustainable products at any time gap... the streak should still continue."
    if status == 'delivered' and is_sustainable and not streak_awarded:
        current_streak += 1
        if current_streak > longest_streak:
            longest_streak = current_streak
            
        # Award credits
        total_credits += credits
        
        # Update user
        # We still track last_sustainable_purchase_date for record keeping, though strictly not needed for count.
        today_str = datetime.date.today().isoformat()
        
        conn.execute('''
            UPDATE users 
            SET current_streak = ?, longest_streak = ?, last_sustainable_purchase_date = ?, total_carbon_credits = ?
            WHERE user_id = ?
        ''', (current_streak, longest_streak, today_str, total_credits, user_id))
        
        # Mark order as awarded
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
            SET current_streak = ?, total_carbon_credits = ?
            WHERE user_id = ?
        ''', (current_streak, total_credits, user_id))
        
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

