from flask import Flask, send_file, jsonify, request
import io
import subprocess

app = Flask(__name__)

def capture_photo():
    result = subprocess.run(
        ['libcamera-still', '--nopreview', '-o', '/tmp/photo.jpg', '-t', '500'],
        capture_output=True, timeout=10
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode())
    with open('/tmp/photo.jpg', 'rb') as f:
        return f.read()

@app.route('/photo')
def photo():
    data = capture_photo()
    return send_file(io.BytesIO(data), mimetype='image/jpeg')

@app.route('/command', methods=['POST'])
def command():
    cmd = request.json.get('command', '')
    print(f'コマンド受信: {cmd}')
    # 今後ここにPiCar-X制御を追加
    return jsonify({'status': 'ok', 'command': cmd})

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
