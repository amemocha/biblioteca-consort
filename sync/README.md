# Sincronización de documentos — Biblioteca Consorte

Esta carpeta contiene la preparación de una futura sincronización real entre dispositivos. **La sincronización todavía no está activa.**

Se prevé usar Supabase Auth (correo y contraseña), Storage privado para PDFs y audios, y una tabla Postgres para carpetas, canciones, categorías y vínculos entre documentos. Cada archivo pertenece a la cuenta autenticada y las políticas RLS evitan que otra cuenta lo lea.

Para activarlo se necesita conectar un proyecto de Supabase, ejecutar `sync/schema.sql`, integrar la subida y descarga con la biblioteca existente, ensayar borrados y conflictos con dos dispositivos, y respaldar primero el contenido local. Nunca poner la clave `service_role` en el cliente.

El sitio Render y el APK actual siguen almacenando los archivos localmente. El plan gratuito de Supabase tiene límites y puede requerir facturación según el uso y el almacenamiento.