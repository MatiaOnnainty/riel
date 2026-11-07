// Preferencias de Riel (ventana de GNOME, GTK4 + libadwaita). Todo se guarda
// en los ajustes de la extensión y la isla lo aplica al momento.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {SONIDOS_PROPIOS, reproducirAviso} from './sonido.js';

// Opciones de un enum de los ajustes, en el orden en que se muestran
const MODOS_RECURSOS = [['texto', 'Texto (CPU 12%)'], ['icono', 'Ícono (más angosto)']];
const SONIDOS = [['ninguno', 'Sin sonido'], ...SONIDOS_PROPIOS, ['archivo', 'Archivo propio…']];

// Fila con lista desplegable ligada a una clave de texto o enum
function filaOpciones(ajustes, clave, titulo, opciones, subtitulo = '') {
    const fila = new Adw.ComboRow({
        title: titulo,
        subtitle: subtitulo,
        model: Gtk.StringList.new(opciones.map(([, nombre]) => nombre)),
    });
    const leer = () => {
        const i = opciones.findIndex(([id]) => id === ajustes.get_string(clave));
        fila.selected = Math.max(0, i);
    };
    leer();
    ajustes.connect(`changed::${clave}`, leer);
    fila.connect('notify::selected', () => {
        const id = opciones[fila.selected]?.[0];
        if (id && id !== ajustes.get_string(clave))
            ajustes.set_string(clave, id);
    });
    return fila;
}

export default class RielPreferencias extends ExtensionPreferences {
    fillPreferencesWindow(ventana) {
        const ajustes = this.getSettings();
        ventana.set_default_size(620, 640);
        ventana.add(this._paginaIslas(ajustes));
        ventana.add(this._paginaNotificaciones(ajustes, ventana));
        ventana.add(this._paginaEscritorio(ajustes));
        ventana.add(this._paginaAtajos(ajustes, ventana));
    }

    _paginaIslas(ajustes) {
        const pagina = new Adw.PreferencesPage({title: 'Islas', icon_name: 'view-grid-symbolic'});

        const letra = new Adw.PreferencesGroup({
            title: 'Letra',
            description: 'Tamaño y tipografía del texto de las islas y de sus paneles.',
        });
        const tamano = new Adw.SpinRow({
            title: 'Tamaño',
            subtitle: 'Porcentaje del tamaño normal',
            adjustment: new Gtk.Adjustment({lower: 70, upper: 130, step_increment: 5, page_increment: 10}),
        });
        ajustes.bind('escala-fuente', tamano, 'value', Gio.SettingsBindFlags.DEFAULT);
        letra.add(tamano);

        const tipografia = new Adw.ActionRow({title: 'Tipografía', subtitle: 'La del sistema si no elegís ninguna'});
        const dialogo = new Gtk.FontDialog({title: 'Tipografía de las islas'});
        const boton = new Gtk.FontDialogButton({
            dialog: dialogo,
            level: Gtk.FontLevel.FAMILY,
            valign: Gtk.Align.CENTER,
            use_font: true,
        });
        // Sin elegir, muestra la tipografía del sistema
        const sistema = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const leerFuente = () => {
            const familia = ajustes.get_string('fuente') ||
                Pango.FontDescription.from_string(sistema.get_string('font-name')).get_family();
            boton.font_desc = Pango.FontDescription.from_string(familia);
        };
        leerFuente();
        boton.connect('notify::font-desc', () => {
            const familia = boton.font_desc?.get_family() ?? '';
            const delSistema = Pango.FontDescription.from_string(sistema.get_string('font-name')).get_family();
            // Elegir la del sistema es lo mismo que no elegir ninguna
            const valor = familia === delSistema ? '' : familia;
            if (valor !== ajustes.get_string('fuente'))
                ajustes.set_string('fuente', valor);
        });
        const restablecer = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: 'Volver a la del sistema',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        restablecer.connect('clicked', () => {
            ajustes.reset('fuente');
            leerFuente();
        });
        tipografia.add_suffix(boton);
        tipografia.add_suffix(restablecer);
        letra.add(tipografia);
        pagina.add(letra);

        const derecha = new Adw.PreferencesGroup({title: 'Isla derecha'});
        derecha.add(filaOpciones(ajustes, 'recursos-modo', 'CPU y RAM', MODOS_RECURSOS,
            'El ícono ocupa menos lugar en pantallas chicas'));
        pagina.add(derecha);
        return pagina;
    }

    _paginaNotificaciones(ajustes, ventana) {
        const pagina = new Adw.PreferencesPage({title: 'Avisos', icon_name: 'preferences-system-notifications-symbolic'});

        const aviso = new Adw.PreferencesGroup({
            title: 'Aviso',
            description: 'Lo que suena cuando una notificación aparece en la isla central.',
        });
        const probar = new Gtk.Button({label: 'Probar', valign: Gtk.Align.CENTER});
        probar.connect('clicked', () => reproducirAviso(ajustes));
        aviso.set_header_suffix(probar);
        aviso.add(filaOpciones(ajustes, 'sonido', 'Sonido', SONIDOS));

        const archivo = new Adw.ActionRow({title: 'Archivo de sonido'});
        const elegir = new Gtk.Button({label: 'Elegir…', valign: Gtk.Align.CENTER});
        elegir.connect('clicked', () => {
            const filtro = new Gtk.FileFilter({name: 'Sonidos'});
            filtro.add_mime_type('audio/*');
            const filtros = new Gio.ListStore({item_type: Gtk.FileFilter});
            filtros.append(filtro);
            new Gtk.FileDialog({title: 'Sonido del aviso', filters: filtros}).open(ventana, null, (dialogo, resultado) => {
                try {
                    const elegido = dialogo.open_finish(resultado);
                    if (elegido?.get_path())
                        ajustes.set_string('sonido-archivo', elegido.get_path());
                } catch {
                    // cancelado
                }
            });
        });
        archivo.add_suffix(elegir);
        const leerArchivo = () => {
            archivo.visible = ajustes.get_string('sonido') === 'archivo';
            const ruta = ajustes.get_string('sonido-archivo');
            archivo.subtitle = ruta ? Gio.File.new_for_path(ruta).get_basename() : 'Ninguno elegido';
        };
        leerArchivo();
        ajustes.connect('changed::sonido', leerArchivo);
        ajustes.connect('changed::sonido-archivo', leerArchivo);
        aviso.add(archivo);

        const volumen = new Adw.ActionRow({title: 'Volumen'});
        const escala = new Gtk.Scale({
            adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 5, page_increment: 10}),
            draw_value: true,
            value_pos: Gtk.PositionType.RIGHT,
            hexpand: true,
            valign: Gtk.Align.CENTER,
            width_request: 220,
        });
        escala.set_format_value_func((_e, valor) => `${Math.round(valor)}%`);
        ajustes.bind('volumen-aviso', escala.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        volumen.add_suffix(escala);
        aviso.add(volumen);
        pagina.add(aviso);

        // Silenciado por app: las que ya mostraron notificaciones
        const apps = new Adw.PreferencesGroup({
            title: 'Aviso por app',
            description: 'Apagado: sus notificaciones quedan en la lista de la isla, sin aviso ni sonido.',
        });
        pagina.add(apps);
        let filas = [];
        const dibujarApps = () => {
            filas.forEach(fila => apps.remove(fila));
            filas = [];
            const avisadas = ajustes.get_strv('apps-avisadas');
            const silenciadas = ajustes.get_strv('apps-silenciadas');
            if (!avisadas.length) {
                filas.push(new Adw.ActionRow({title: 'Todavía ninguna app mostró notificaciones'}));
            } else {
                for (const entrada of [...avisadas].sort((a, b) => a.split('|')[1].localeCompare(b.split('|')[1]))) {
                    const [id, nombre] = entrada.split('|');
                    const fila = new Adw.SwitchRow({title: nombre || id, active: !silenciadas.includes(id)});
                    fila.connect('notify::active', () => {
                        const actuales = ajustes.get_strv('apps-silenciadas').filter(x => x !== id);
                        ajustes.set_strv('apps-silenciadas', fila.active ? actuales : [...actuales, id]);
                    });
                    filas.push(fila);
                }
            }
            filas.forEach(fila => apps.add(fila));
        };
        dibujarApps();
        ajustes.connect('changed::apps-avisadas', dibujarApps);
        return pagina;
    }

    _paginaEscritorio(ajustes) {
        const pagina = new Adw.PreferencesPage({title: 'Escritorio', icon_name: 'user-desktop-symbolic'});
        const grupo = new Adw.PreferencesGroup({title: 'Ubuntu Dock'});
        const fila = new Adw.SwitchRow({
            title: 'Ocultar el Ubuntu Dock',
            subtitle: 'Las apps ya están en la isla izquierda. Al desactivar Riel el dock vuelve.',
        });
        ajustes.bind('ocultar-dock', fila, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupo.add(fila);
        pagina.add(grupo);
        return pagina;
    }

    _paginaAtajos(ajustes, ventana) {
        const pagina = new Adw.PreferencesPage({title: 'Atajos', icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic'});
        const grupo = new Adw.PreferencesGroup({
            title: 'Isla central',
            description: 'Con la isla cerrada, el atajo la abre; abierta, cambia de panel.',
        });
        grupo.add(this._filaAtajo(ajustes, ventana, 'atajo-panel-siguiente', 'Panel siguiente'));
        grupo.add(this._filaAtajo(ajustes, ventana, 'atajo-panel-anterior', 'Panel anterior'));
        pagina.add(grupo);
        return pagina;
    }

    // Fila de atajo: clic, se aprieta la combinación y queda guardada.
    // Retroceso lo borra; Esc cancela
    _filaAtajo(ajustes, ventana, clave, titulo) {
        const fila = new Adw.ActionRow({title: titulo, activatable: true});
        const etiqueta = new Gtk.ShortcutLabel({disabled_text: 'Sin asignar', valign: Gtk.Align.CENTER});
        const leer = () => (etiqueta.accelerator = ajustes.get_strv(clave)[0] ?? '');
        leer();
        ajustes.connect(`changed::${clave}`, leer);
        fila.add_suffix(etiqueta);

        fila.connect('activated', () => {
            const dialogo = new Adw.Window({
                modal: true,
                transient_for: ventana,
                default_width: 360,
                title: titulo,
            });
            const caja = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12,
                margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24});
            caja.append(new Gtk.Label({label: `Apretá la combinación para «${titulo}»`, wrap: true}));
            caja.append(new Gtk.Label({label: 'Esc cancela · Retroceso lo borra', css_classes: ['dim-label']}));
            dialogo.set_content(caja);

            const teclado = new Gtk.EventControllerKey();
            teclado.connect('key-pressed', (_c, tecla, _codigo, estado) => {
                const mods = estado & Gtk.accelerator_get_default_mod_mask();
                if (!mods && tecla === Gdk.KEY_Escape) {
                    dialogo.close();
                    return Gdk.EVENT_STOP;
                }
                if (!mods && tecla === Gdk.KEY_BackSpace) {
                    ajustes.set_strv(clave, []);
                    dialogo.close();
                    return Gdk.EVENT_STOP;
                }
                // Solo modificadores todavía: se espera la tecla
                if (!Gtk.accelerator_valid(tecla, mods))
                    return Gdk.EVENT_STOP;
                ajustes.set_strv(clave, [Gtk.accelerator_name(tecla, mods)]);
                dialogo.close();
                return Gdk.EVENT_STOP;
            });
            dialogo.add_controller(teclado);
            dialogo.present();
        });
        return fila;
    }
}
