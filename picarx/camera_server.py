from flask import Flask, send_file, jsonify, request
from vilib import Vilib
from time import sleep, time
import os
import io

app = Flask(__name__)
PHOTO_DIR = '/tmp/picarx_photos'
os.makedirs(PHOTO_DIR, exist_ok=True)

# カメラ起動（サーバー起動時に一度だけ）
Vilib.camera_start(vflip=False, hflip=False)
Vilib.display(local=False, web=False)
sleep(2)  # カメラウォームアップ待機
print('カメラ起動完了')

@app.route('/photo')
def photo():
    name = f'photo_{int(time())}'
    Vilib.take_photo(name, PHOTO_DIR + '/')
    filepath = os.path.join(PHOTO_DIR, name + '.jpg')
    sleep(0.5)  # 書き込み完了待機
    if not os.path.exists(filepath):
        return jsonify({'error': '撮影失敗'}), 500
    with open(filepath, 'rb') as f:
        data = f.read()
    os.remove(filepath)
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
    app.run(host='0.0.0.0', port=5000, debug=False)
