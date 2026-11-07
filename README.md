# Riel

Extensión de GNOME Shell que aprovecha mejor el panel superior:

- **Izquierda:** tus apps fijadas y abiertas, en lugar del dock inferior.
- **Centro:** un carrusel con lo que está sonando (cualquier reproductor que
  use MPRIS: Spotify, Firefox, VLC…), el estado de tus sesiones de Claude
  Code y más.
- **Derecha:** el menú del sistema, como está hoy.

> Estado: fase 1 en curso (islas, apps fijadas y abiertas, reloj).

## Versiones

| | Versión |
| --- | --- |
| GNOME Shell | 46 |
| Sistema | Ubuntu 24.04 LTS, Wayland |
| Pantalla de referencia | 1366×768 |

## Desarrollo

Una extensión corre **dentro de GNOME Shell**: si falla, puede tirar el
escritorio entero. Por eso se prueba en un Shell aparte.

### Día a día: sesión anidada (`dev.sh`)

```bash
./dev.sh            # abre un GNOME Shell de pruebas en una ventana
./dev.sh --limpio   # lo mismo, empezando de cero
```

- Es tu mismo GNOME 46, con el Ubuntu Dock, a la resolución de tu pantalla
  (otra: `RIEL_RESOLUCION=1920x1080 ./dev.sh`).
- **Está aislado:** usa su propio bus D-Bus y su propia configuración en
  `.dev/`. Activar o romper Riel ahí no toca tu escritorio real.
- Se ven tus apps, íconos y fuentes, y se copian tus fijadas y tu tema.
- Si lo corrés desde la terminal de VS Code (snap), se vuelve a abrir solo
  en GNOME Terminal: dentro del snap, GNOME confunde cada ventana de prueba
  con VS Code.
- Las apps que abras ahí (Archivos, Terminal…) se abren adentro de la
  ventana de pruebas. No hay llavero de contraseñas y las apps solo X11 no
  abren. Evitá Firefox, VS Code o Edge si ya están abiertos en tu escritorio.
- Para probar un cambio: cerrá la ventana y volvé a correr `./dev.sh`. En
  Wayland no se puede recargar una extensión sin reiniciar el Shell.
- Los errores de Riel aparecen en la terminal como `JS ERROR`. El resto de
  los mensajes (dbus-daemon, `GLib-GIO-CRITICAL`, gvfs) son normales en una
  sesión anidada.
- Dentro de la ventana, Alt+F2 → `lg` abre **Looking Glass**, el inspector
  del Shell.

### Antes de cerrar una fase: máquina virtual

Una VM con Ubuntu 24.04 (instalación mínima, 3 GB de RAM, 2 núcleos) en
virt-manager, para lo que la sesión anidada no cubre: una instalación limpia,
el bloqueo de pantalla (GNOME desactiva y reactiva las extensiones al
bloquear), varios monitores y otras versiones de GNOME.

### En tu escritorio: solo versiones estables

```bash
gnome-extensions pack extension/ --force
gnome-extensions install --force riel@matiaonnainty.github.io.shell-extension.zip
# cerrar sesión y volver a entrar; después:
gnome-extensions enable riel@matiaonnainty.github.io
```

**Si el escritorio queda trabado:**

1. Ctrl+Alt+F3 abre una terminal de texto. Iniciá sesión.
2. `gsettings set org.gnome.shell disable-user-extensions true` desactiva
   todas tus extensiones.
3. Ctrl+Alt+F2 (o Ctrl+Alt+F1) para volver, o reiniciá la sesión.
4. Para reactivarlas: `gsettings set org.gnome.shell disable-user-extensions false`.

## Estructura

| Ruta | Qué contiene |
| --- | --- |
| `extension/` | La extensión tal como se instala |
| `extension/extension.js` | Arma y desarma las partes en `enable()` / `disable()` |
| `extension/islas.js` | Panel transparente con tres islas y sus esquinas cóncavas |
| `extension/apps.js` | Isla izquierda: cuadrícula de apps, fijadas y abiertas |
| `extension/reloj.js` | Isla central: hora y fecha |
| `extension/stylesheet.css` | Colores, radios y tamaños de las islas |
| `dev.sh` | Shell de pruebas aislado |
| `.dev/` | Configuración de la sesión de pruebas (no se sube) |

## Licencia

[GPL-2.0-or-later](LICENSE), como GNOME Shell. Es la licencia que exige
extensions.gnome.org para publicar.

© 2026 Matias A. Onnainty
