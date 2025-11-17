import requests
import json
from bs4 import BeautifulSoup
import os

# The URL of the API you already built
API_URL = "http://127.0.0.1:5000/v1/feedback"

# --- 1. CHANGE THE TARGET URL ---
TARGET_URL = "http://quotes.toscrape.com/" 

def post_feedback_to_api(platform, text, store_id):
    """
    Takes data and POSTs it to our Flask API.
    """
    payload = {
        "platform": platform,
        "text": text,
        "store_id": store_id
    }
    
    try:
        response = requests.post(API_URL, json=payload)
        if response.status_code == 201:
            print(f"  > Successfully posted: {text}")
        else:
            print(f"  > Error posting feedback. Status code: {response.status_code}")
    except requests.exceptions.ConnectionError:
        print("Error: Could not connect to the API. Is your Flask server running?")
        return False
    return True

def scrape_live_website(url):
    """
    Downloads a live web page and parses it with BeautifulSoup.
    """
    print(f"Attempting to download page: {url}")
    
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(url, headers=headers)
        
        if response.status_code != 200:
            print(f"Error: Failed to download website. Status code: {response.status_code}")
            return
            
        html_content = response.text
        soup = BeautifulSoup(html_content, 'html.parser')
        
        
        # --- 2. CHANGE THE PARSING LOGIC ---
        # "Inspect" quotes.toscrape.com, you'll find these tags:
        
        # Find all divs with the class "quote"
        reviews = soup.find_all('div', class_='quote') 
        
        print(f"Found {len(reviews)} reviews (quotes). Posting to API...")
        
        for review in reviews:
            # Find the text (a <span> with class "text")
            text = review.find('span', class_='text').text.strip()
            
            # Find the "platform" (the <small> tag with class "author")
            platform = review.find('small', class_='author').text.strip()
            
            # We'll hard-code all these to Store ID 1 ("Downtown Diner")
            store_id = 1 
            
            print(f"\nProcessing quote from {platform}...")
            if not post_feedback_to_api(platform, text, store_id):
                break
                
    except requests.exceptions.RequestException as e:
        print(f"Error: Failed to connect to {url}. {e}")

# --- Main part of the script ---
if __name__ == "__main__":
    print("--- Extractor Run Started ---")
    
    # We now call our new function with the target URL
    scrape_live_website(TARGET_URL)
    
    print("\n--- Extractor Run Finished ---")