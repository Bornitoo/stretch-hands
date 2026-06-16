# Stretch Hands 🖐️➰

Сожми 👌 **большой палец с любым другим** и потяни руку — между точкой защипа и рукой
растянется «жвачка» (Gomu-Gomu, как у Луффи). Отпусти щипок — она упруго отскочит назад
с overshoot. Прямо в браузере через вебкамеру, два режима рендера.

Всё работает **локально в браузере** — видео и записи никуда не отправляются.

> Механика и «фил» эффекта портированы из десктоп-эталона
> [gazellecheetah/gum-gum-hand-stretch](https://github.com/gazellecheetah/gum-gum-hand-stretch)
> (Python/OpenCV) — мы перенесли их в браузер/JS. Брендинг свой, нейтральный, без чужих
> товарных знаков.

## Что внутри

- **Трекинг:** MediaPipe `HandLandmarker` (21 точка кисти), полностью на устройстве через
  `@mediapipe/tasks-vision`.
- **Механика щипка** (`pinch.js`): защип с гистерезисом, замороженный якорь, машина
  состояний idle→stretching→snapping, возврат к якорю по кривой `ease-out-back` (overshoot).
- **Рендер:**
  - *Мультяшный* — «гумка» на canvas2D: безье с боковым «пузом», сужение к кончику,
    истончение по сохранению объёма, блик, скруглённый кончик.
  - *Реалистичный* — WebGL: реальные пиксели кожи у руки растягиваются вдоль нити.
- **Фишки:** «свист» при растяжении и «бойнг» при отскоке, снимок PNG и запись webm.
- **Производительность:** одна лёгкая модель кисти на кадр, камера 640×480, ленивый
  WebGL-контекст; в углу — счётчик `fps · GPU/CPU`.

## Структура

```
public/
  index.html, css/style.css
  js/
    tracker.js          камера + HandLandmarker → единый объект кадра
    pinch.js            ЧИСТАЯ логика щипка/нити/отскока — тестируется в Node
    render-cartoon.js   рендер №1 (canvas2D «гумка»)
    render-realistic.js рендер №2 (WebGL-лизквифай)
    sfx.js              звук на Web Audio
    capture.js          снимок + запись
    app.js              сборка и UI
  vendor/mediapipe/     рантайм и модели (не в git — см. ниже)
test/pinch.test.mjs     юнит-тесты ядра
wrangler.toml           деплой на Cloudflare Workers (Static Assets)
scripts/fetch-models.sh загрузка моделей MediaPipe
```

## Запуск локально

```bash
bash scripts/fetch-models.sh     # один раз: скачать рантайм и модели в public/vendor/mediapipe
npx wrangler dev                 # http://localhost:8787
```

Открой в Chrome, разреши доступ к камере, жми «Включить камеру».
`?debug=1` — каркас руки и панель настроек. `?` без камеры эффект не запускается.

## Тесты

```bash
node --test test/*.test.mjs
```

## Деплой (Cloudflare Workers)

```bash
export CLOUDFLARE_API_TOKEN=...   # токен с правом Workers
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler deploy
```

## Приватность

Инференс, рендер и запись — целиком в браузере. Никакие кадры не уходят на сервер.

## Лицензия

MIT.
