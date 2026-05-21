from flask import Flask, request, jsonify
import numpy as np
from PIL import Image
import io

app = Flask(__name__)

def classify_waste(image_bytes):
    # Open image
    img = Image.open(io.BytesIO(image_bytes))
    img = img.convert('RGB')
    img = img.resize((100, 100))
    pixels = np.array(img)
    
    # Get average color
    avg_r = np.mean(pixels[:,:,0])
    avg_g = np.mean(pixels[:,:,1])
    avg_b = np.mean(pixels[:,:,2])
    
    # Simple brightness check
    brightness = (avg_r + avg_g + avg_b) / 3
    
    # Classification based on dominant color
    if avg_r > avg_g and avg_r > avg_b:
        waste_type = "recyclable"
        sub_type = "plastic"
    elif avg_g > avg_r and avg_g > avg_b:
        waste_type = "recyclable"
        sub_type = "paper"
    elif avg_b > avg_r and avg_b > avg_g:
        waste_type = "recyclable"
        sub_type = "glass"
    elif brightness < 80:
        waste_type = "recyclable"
        sub_type = "metal"
    else:
        waste_type = "recyclable"
        sub_type = "plastic"
    
    return waste_type, sub_type

@app.route('/api/classify', methods=['POST'])
def classify():
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400
    
    image_file = request.files['image']
    image_bytes = image_file.read()
    
    waste_type, sub_type = classify_waste(image_bytes)
    
    return jsonify({
        'waste_type': waste_type,
        'sub_type': sub_type
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
