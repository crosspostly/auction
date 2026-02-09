import requests
import json
import sys

TOKEN = "vk1.a.H6v5lstlQKqsJCa1MCSaHPaw4nGVkk9s_3xnDwGNFyIxum45n_uN7vLhPgGThdMegQlhTk2MZBRBY41Fb98x6qrXXntyzduHCI2-PUe3GlMfGLvN8CY5AeJkgv4wXEp252JcmzeuoMJ9y57DcDDdf3mdzonQ8nhlQXGRlLKqhl-ancCOBVC1gIP0tGbdFjQICNBb1Zqwj1on6tH59QIr2A"
GROUP_ID = "96798355"
WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwm3U_WM7LbZmODcXFiJPLdBz117fvGKZskaea0j9K5s_2tKptMncPhSAOnmlMoR3DG/exec"
VERSION = "5.131"

def call_vk(method, params):
    params['access_token'] = TOKEN
    params['v'] = VERSION
    res = requests.post(f"https://api.vk.com/method/{method}", data=params).json()
    if 'error' in res:
        print(f"❌ Ошибка в {method}: {res['error']['error_msg']} (код {res['error']['error_code']})")
        return res
    return res['response']

def debug_setup():
    print(f"--- Начинаю отладку для группы {GROUP_ID} ---")
    
    # 1. Получаем список серверов
    print("1. Получаю список существующих серверов...")
    servers = call_vk("groups.getCallbackServers", {"group_id": GROUP_ID})
    if 'error' in servers: return

    print(f"Найдено серверов: {servers['count']}")
    
    server_id = None
    
    # 2. Ищем наш URL в списке
    for s in servers['items']:
        if s['url'] == WEB_APP_URL:
            print(f"✅ Наш сервер уже есть! ID: {s['id']}, Статус: {s['status']}")
            server_id = s['id']
            break
    
    # 3. Если серверов 25 или больше и нашего нет - удаляем самый старый (кроме важных)
    if not server_id and servers['count'] >= 25:
        print("⚠ Лимит 25 серверов достигнут. Удаляю самый старый сервер для освобождения места...")
        oldest_id = servers['items'][0]['id']
        call_vk("groups.deleteCallbackServer", {"group_id": GROUP_ID, "server_id": oldest_id})
        print(f"🗑 Удален сервер ID {oldest_id}")

    # 4. Добавляем сервер, если его нет
    if not server_id:
        print("2. Добавляю новый сервер...")
        res = call_vk("groups.addCallbackServer", {
            "group_id": GROUP_ID,
            "url": WEB_APP_URL,
            "title": "GAS_Bot" # Короткий заголовок (до 14 симв)
        })
        if 'error' in res:
            print("🛑 Не удалось добавить сервер. Дальнейшая настройка невозможна.")
            return
        server_id = res['server_id']
        print(f"✅ Сервер добавлен! ID: {server_id}")

    # 5. Настраиваем события
    print(f"3. Включаю уведомления для сервера {server_id}...")
    settings_res = call_vk("groups.setCallbackSettings", {
        "group_id": GROUP_ID,
        "server_id": server_id,
        "wall_post_new": 1,
        "wall_reply_new": 1,
        "message_new": 1
    })
    
    if settings_res == 1:
        print("✨ ВСЁ УСПЕШНО НАСТРОЕНО! Бот должен видеть посты и комменты.")
    else:
        print("❓ ВК вернул странный ответ при настройке событий.")

if __name__ == "__main__":
    debug_setup()
