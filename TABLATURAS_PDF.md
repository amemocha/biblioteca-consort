# Conversión PDF → tablatura (prototipo)

La pantalla `tablaturas.html` admite MusicXML directamente. Para PDF, envía el archivo a `POST /api/transcribe-pdf` y espera un JSON con `musicxml`. El servidor `tablatura_api.py` implementa esa ruta y ejecuta Audiveris por línea de comandos.

## Requisitos de servidor

- Python 3.10 o superior.
- Audiveris instalado en la misma máquina, con Java y sus dependencias nativas.
- `AUDIVERIS_BIN` apuntando al ejecutable correcto.
- Proxy de `/api/transcribe-pdf` hacia el proceso `python3 tablatura_api.py` (por defecto puerto 10000). Si se usa un dominio distinto, hay que configurar el origen, OPTIONS/CORS y la URL del frontend.
- Memoria y tiempo suficientes para reconocer PDF; las instancias gratuitas pequeñas pueden no alcanzar.

Este componente **no está desplegado** ni validado con un PDF real. La rama solo contiene el código de integración. No fusionar ni publicar como servicio PDF funcional sin probarlo y configurar el backend.

## Limitaciones

- El motor OCR musical puede equivocarse con voces múltiples, alteraciones, notas y silencios.
- El renderizador de tablatura es básico y no produce pentagrama+tab sincronizados todavía.
- Solo se usa el primer movimiento del MXL exportado.
- Los archivos PDF se transmiten al servidor de reconocimiento: no afirmar que se procesan únicamente de manera local.
- Verificar las digitaciones y el resultado con la partitura original antes del uso musical.
