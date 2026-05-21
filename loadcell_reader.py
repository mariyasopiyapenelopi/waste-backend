import serial
import paho.mqtt.client as mqtt
import time
import json

SERIAL_PORT = '/dev/ttyUSB0'
BAUD_RATE = 57600
MQTT_BROKER = 'localhost'
MQTT_PORT = 1883
MQTT_TOPIC_WEIGHT = 'waste/compartment/A/weight'
MQTT_TOPIC_STATUS = 'waste/compartment/A/status'

# Known calibration weight in grams
KNOWN_WEIGHT = '1160.0'

client = mqtt.Client()
client.connect(MQTT_BROKER, MQTT_PORT, 60)
client.loop_start()

ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
time.sleep(2)

print("Load cell reader started!")

status_payload = json.dumps({'is_active': True})
client.publish(MQTT_TOPIC_STATUS, status_payload)

tare_done = False
calibration_done = False

while True:
    try:
        raw = ser.readline()
        line = raw.decode('utf-8', errors='ignore').strip()

        if line:
            print(f"Raw data received: '{line}'")

        # Step 1 — Send tare command
        if line and 'send' in line.lower() and 'tare' in line.lower() and not tare_done:
            time.sleep(1)
            ser.write(b't\n')
            ser.flush()
            print(">> Sent tare command 't' to Arduino!")
            tare_done = True
            continue

        # Step 2 — Place known mass prompt
        if line and 'place' in line.lower() and 'known' in line.lower():
            print(f">> Place your {KNOWN_WEIGHT}g water bottle on the load cell NOW!")
            print(">> Waiting 5 seconds for you to place it...")
            time.sleep(5)
            continue

        # Step 3 — Send known weight value
        if line and 'send the weight' in line.lower() and not calibration_done:
            time.sleep(1)
            ser.write(f'{KNOWN_WEIGHT}\n'.encode())
            ser.flush()
            print(f">> Sent calibration weight: {KNOWN_WEIGHT}g")
            calibration_done = True
            continue

        # Step 4 — Read and publish weight data
        if calibration_done and line:
            try:
                numbers = ''
                for c in line:
                    if c.isdigit() or c == '.':
                        numbers += c

                if numbers:
                    weight_g = float(numbers)
                    weight_kg = round(weight_g / 1000, 3)

                    if weight_kg >= 0:
                        payload = json.dumps({
                            'waste_type': 'recyclable',
                            'sub_type': 'plastic',
                            'weight_kg': weight_kg
                        })
                        client.publish(MQTT_TOPIC_WEIGHT, payload)
                        print(f"✅ Published weight: {weight_kg} kg ({weight_g}g)")

            except ValueError:
                print(f"Could not parse: '{line}'")

    except Exception as e:
        print(f"Error: {e}")
        time.sleep(1)
