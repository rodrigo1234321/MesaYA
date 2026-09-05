# MesaYA — Guía de Hardware & NFC para la Costa Atlántica (Mar del Plata)

## 1. Especificación de Tags NFC
- **Chip Requerido**: NTAG215 (504 bytes de memoria utilizable, compatible universal con iPhone XS/11/12/13/14/15/16 y Android con NFC).
- **Capa Anti-Metal (Ferrita Obligatoria)**: Mesas de acero inoxidable, aluminio o bases de hierro requieren lámina de ferrita aislante entre el tag y la superficie metálica. Sin ferrita, el metal absorbe el campo electromagnético y el tag no lee.
- **Formato**: Monedas rígidas de 25-30mm o stickers anti-metal de 30mm.

## 2. Protección Climatológica (Anti-Salitre & Humedad Marina)
- **Cuerpo / Soporte**: Bloques de acrílico cristal o base de madera petiribí/paraíso con cavidad fresada.
- **Sellado**: Encapsulado en resina epoxi bicomponente UV-resistant (evita amarilleo por sol y corrosión de contactos por salitre).
- **Adhesivo de Fijación a la Mesa**: 3M 300LSE (High Surface Energy & Low Surface Energy) de alta adherencia para resistir alcohol, lavandina y limpieza diaria del personal de salón.
- **Grabado QR**: Grabado láser directo sobre acrílico bicapa (negro/blanco o dorado/negro), nunca tinta impresa que se borra con el roce y el sol en terrazas.

## 3. Programación Rápida de Tags con Celular (NFC Tools)
1. Descargar **NFC Tools** (gratis en iOS y Android).
2. Abrir la app → **Escribir (Write)** → **Añadir un registro (Add a record)** → **URL / URI**.
3. Ingresar la URL de la mesa (Ej: `https://mesaya.app/mesa/1?token=UUID` o el link canónico del restaurante).
4. Tocar **Escribir (Write)** y acercar el celular al tag NTAG215.
5. (Opcional recomendado para producción): **Bloquear tag en modo solo lectura (Lock Tag)** para evitar que comensales sobreescriban la URL.
