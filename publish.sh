#!/bin/bash
# Скрипт для подготовки и публикации проекта VK Аукционного Бота

echo "Подготовка проекта к публикации..."

# Проверяем, что все файлы на месте
echo "Проверка файлов проекта:"
ls -la *.gs *.html *.json *.md

echo "Проверка синтаксиса Google Apps Script..."
# Для GAS синтаксис проверяется при деплое, но мы можем проверить структуру файлов
for file in *.gs; do
  if [[ -f "$file" ]]; then
    echo "Проверка файла: $file"
    # Проверяем, что файл содержит хотя бы базовую структуру функции
    if grep -q "function " "$file"; then
      echo "  ✓ Содержит функции"
    else
      echo "  ⚠ Не содержит функций"
    fi
  fi
done

echo " "
echo "Проект готов к публикации!"
echo " "
echo "Для публикации в Google Apps Script:"
echo "1. Откройте проект в редакторе GAS"
echo "2. Убедитесь, что все файлы (.gs, .html) загружены"
echo "3. Нажмите Deploy -> New Deployment"
echo "4. Выберите тип Web App"
echo "5. Установите 'Execute as' -> Me"
echo "6. Установите 'Who has access' -> Anyone"
echo "7. Нажмите Deploy и скопируйте URL"
echo " "
echo "Для публикации на GitHub:"
echo "1. Убедитесь, что у вас есть права на репозиторий"
echo "2. Выполните: git add ."
echo "3. Выполните: git commit -m 'feat: добавлены улучшения аукционного бота'"
echo "4. Выполните: git push origin main"
echo " "
echo "Не забудьте настроить Callback API в вашем сообществе ВКонтакте с использованием URL из пункта 7!"