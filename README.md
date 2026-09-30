# Distancias Ley 11.178 · mapa satelital

App web para calcular zonas de exclusión y amortiguamiento (Ley 11.178 de Entre Ríos) sobre imagen satelital.

## Publicarla gratis en GitHub Pages (una sola vez, ~10 minutos)

1. Creá una cuenta en https://github.com (si no tenés).
2. Arriba a la derecha: **+ → New repository**. Nombre: `distancias-11178`. Marcá **Public**. **Create repository**.
3. En la página del repositorio: **uploading an existing file**. Arrastrá TODOS los archivos de esta carpeta
   (index.html, app.js, styles.css, sw.js, manifest.webmanifest, icon.svg, icon-192.png, icon-512.png). **Commit changes**.
4. **Settings → Pages**. En *Branch* elegí `main` y carpeta `/ (root)`. **Save**.
5. En uno o dos minutos queda en: `https://TU-USUARIO.github.io/distancias-11178/`

Ese es el link para compartir. En el celular, abrilo en Chrome → menú ⋮ → **Agregar a pantalla principal** (en iPhone: Safari → Compartir → **Agregar a inicio**).

## Actualizar
Subí el archivo modificado al mismo repositorio (**Add file → Upload files**) y confirmá. Si cambiás app.js o styles.css,
subí también `sw.js` cambiando `d11178-app-v1` por `d11178-app-v2` para que los celulares tomen la versión nueva.

## Fondo satelital de Google (opcional)
1. En https://console.cloud.google.com creá un proyecto, activá la facturación y habilitá **Map Tiles API**.
2. Creá una clave en **APIs y servicios → Credenciales** y restringila a tu dominio `TU-USUARIO.github.io/*` y a la Map Tiles API.
3. Pegala en `app.js`, línea `const GOOGLE_API_KEY = "";`.
Sin clave usa Esri World Imagery (revisá sus condiciones si el uso es comercial).

## Uso sin señal
Abrí el lote con señal antes de ir al campo y recorré con zoom la zona: la app y las imágenes vistas quedan guardadas en el teléfono.
Los datos (áreas, lote) se guardan sólo en ese dispositivo.

## Exportar
- **KML**: Google Earth, Google My Maps y DJI SmartFarm (subís el KML en la web de SmartFarm y lo sincronizás al control del Agras). Trae carpetas: lote, superficie aplicable, áreas sensibles, exclusión y amortiguamiento.
- **GeoJSON**: QGIS (arrastrás el archivo al lienzo).

La capa "superficie aplicable" es el lote menos lo que no se puede tratar con la clase de producto elegida.
