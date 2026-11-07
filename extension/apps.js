// Isla izquierda: la cuadrícula de aplicaciones, tus apps fijadas y las que
// están abiertas. Reemplaza al botón "Actividades" mientras Riel está activa.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Vista, ventanasAca} from './vista.js';

const TAMANO_ICONO = 20;
// Un punto por ventana abierta, hasta este máximo
const MAX_PUNTOS = 3;
// Cuánto hay que dejar el cursor sobre una app para ver sus ventanas: evita
// abrir vistas al pasar de largo por la barra
const DEMORA_APERTURA_MS = 1000;
// Margen para llevar el cursor del ícono a la vista sin que se cierre
const DEMORA_CIERRE_MS = 400;

// Ventanas que cuentan para los puntos: las de todos los escritorios
function ventanasDe(app) {
    return app.get_windows().filter(ventana => !ventana.skip_taskbar);
}

// 'ver-ventanas': el clic pide la vista con sus ventanas (tiene varias)
// 'usada': el clic hizo otra cosa (abrir, traer, minimizar, menú)
const BotonApp = GObject.registerClass({
    Signals: {'ver-ventanas': {}, 'usada': {}},
}, class BotonApp extends St.Button {
    _init(app) {
        super._init({
            style_class: 'panel-button riel-app',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            accessible_name: app.get_name(),
            can_focus: true,
        });
        this.app = app;

        // Los puntos se superponen abajo, sin empujar al ícono: así el ícono
        // queda en el centro exacto del círculo del hover
        // (BinLayout solo respeta la alineación de los hijos con expand)
        const caja = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        caja.add_child(app.create_icon_texture(TAMANO_ICONO));
        this._puntos = new St.BoxLayout({
            style_class: 'riel-app-puntos',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true,
        });
        caja.add_child(this._puntos);
        this.set_child(caja);

        this._menu = null;
        app.connectObject('windows-changed', () => this.actualizar(), this);
        this.connect('clicked', (_boton, numero) => this._alClic(numero));
        this.connect('destroy', () => this._menu?.destroy());
        this.actualizar();
    }

    // El menú de GNOME (ventanas abiertas, nueva ventana, fijar, salir…) se
    // crea recién al primer clic derecho, como en el dash
    _abrirMenu() {
        if (!this._menu) {
            this._menu = new AppMenu(this, St.Side.TOP, {
                favoritesSection: true,
                showSingleWindows: true,
            });
            this._menu.setApp(this.app);
            Main.uiGroup.add_child(this._menu.actor);
            Main.panel.menuManager.addMenu(this._menu);
        }
        this._menu.toggle();
    }

    _alClic(numero) {
        const app = this.app;
        const ctrl = Clutter.get_current_event()?.get_state() & Clutter.ModifierType.CONTROL_MASK;

        if (numero === Clutter.BUTTON_SECONDARY) {
            this._abrirMenu();
            this.emit('usada');
            return;
        }

        // Las ventanas de la app en este escritorio, la más reciente primero
        const ventanas = ventanasAca(app);

        if (numero === Clutter.BUTTON_MIDDLE || ctrl) {
            app.open_new_window(-1);
        } else if (ventanas.length > 1) {
            // Varias ventanas: se elige cuál en la vista, como el dock de Ubuntu
            this.emit('ver-ventanas');
            return;
        } else if (!ventanas.length) {
            // Cerrada, o abierta solo en otro escritorio: GNOME decide
            app.activate();
        } else if (Shell.WindowTracker.get_default().focus_app === app) {
            // Clic sobre la app que ya está al frente: se esconde
            ventanas[0].minimize();
        } else {
            ventanas[0].activate(global.get_current_time());
        }
        Main.overview.hide();
        this.emit('usada');
    }

    actualizar() {
        const enfocada = Shell.WindowTracker.get_default().focus_app === this.app;
        // Arrancando todavía no tiene ventanas, pero ya cuenta como abierta
        let cantidad = Math.min(ventanasDe(this.app).length, MAX_PUNTOS);
        if (!cantidad && this.app.state !== Shell.AppState.STOPPED)
            cantidad = 1;
        while (this._puntos.get_n_children() < cantidad)
            this._puntos.add_child(new St.Widget({style_class: 'riel-app-punto'}));
        while (this._puntos.get_n_children() > cantidad)
            this._puntos.get_last_child().destroy();
        if (enfocada)
            this.add_style_pseudo_class('enfocada');
        else
            this.remove_style_pseudo_class('enfocada');
    }
});

export const Apps = GObject.registerClass(
class Apps extends St.BoxLayout {
    _init() {
        super._init({style_class: 'riel-apps'});

        const cuadricula = new St.Button({
            style_class: 'panel-button riel-app riel-cuadricula',
            child: new St.Icon({icon_name: 'view-app-grid-symbolic', style_class: 'system-status-icon'}),
            accessible_name: 'Aplicaciones',
            can_focus: true,
        });
        cuadricula.connect('clicked', () => {
            if (Main.overview.visible)
                Main.overview.hide();
            else
                Main.overview.showApps();
        });
        this.add_child(cuadricula);
        this.add_child(new St.Widget({
            style_class: 'riel-separador',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._lista = new St.BoxLayout({style_class: 'riel-apps-lista'});
        this.add_child(this._lista);
        this._botones = new Map();

        this._vista = new Vista();
        this._vista.connectObject('notify::hover', () => this._alCambiarHover(), this);
        this._apertura = 0;
        this._cierre = 0;
        // Si la vista abierta la abrió un clic (otro clic la cierra) o el cursor
        this._porClic = false;
        Main.overview.connectObject('showing', () => this._cerrarVista(), this);
        this.connect('destroy', () => {
            // Primero se desconecta: al destruirse, la vista pierde el hover y
            // eso armaría un cierre sobre una vista que ya no existe
            this._vista.disconnectObject(this);
            this._vista.destroy();
            this._cancelar();
        });

        this._favoritas = AppFavorites.getAppFavorites();
        this._favoritas.connectObject('changed', () => this._reconstruir(), this);
        Shell.AppSystem.get_default().connectObject(
            'app-state-changed', () => this._reconstruir(),
            'installed-changed', () => this._reconstruir(), this);
        Shell.WindowTracker.get_default().connectObject('notify::focus-app',
            () => this._botones.forEach(boton => boton.actualizar()), this);

        this._reconstruir();
    }

    // Fijadas primero, en su orden; después las abiertas que no están fijadas.
    // Los botones se reutilizan para que la barra no parpadee.
    _reconstruir() {
        const fijadas = this._favoritas.getFavorites();
        const abiertas = Shell.AppSystem.get_default().get_running()
            .filter(app => !fijadas.includes(app));
        const apps = [...fijadas, ...abiertas];

        for (const [app, boton] of this._botones) {
            if (!apps.includes(app)) {
                boton.destroy();
                this._botones.delete(app);
            }
        }

        apps.forEach((app, indice) => {
            let boton = this._botones.get(app);
            if (!boton) {
                boton = new BotonApp(app);
                boton.connect('notify::hover', () => this._alCambiarHover());
                // Un clic que usó la app deja la vista de sobra. No se vuelve
                // a armar la espera: mostraría la ventana recién minimizada
                boton.connect('usada', () => this._cerrarVista());
                // Un clic sobre una app con varias ventanas abre la vista al
                // instante. Otro clic la cierra, pero solo si la abrió un
                // clic: si la abrió el cursor, ese clic era para verla
                boton.connect('ver-ventanas', () => {
                    const abiertaAca = this._vista.abierta && this._vista.app === app;
                    this._cancelar();
                    if (abiertaAca && this._porClic) {
                        this._vista.cerrar();
                    } else {
                        Main.overview.hide();
                        this._vista.mostrar(app);
                        this._porClic = true;
                    }
                });
                this._botones.set(app, boton);
                this._lista.add_child(boton);
            }
            this._lista.set_child_at_index(boton, indice);
            boton.actualizar();
        });
    }

    // Decide qué hacer cada vez que el cursor entra o sale de un ícono o de
    // la vista. Con la vista cerrada, abre tras DEMORA_APERTURA_MS sobre una
    // app con ventanas. Con la vista abierta, pasar a otra app cambia el
    // contenido al instante, y salir de todo la cierra tras DEMORA_CIERRE_MS.
    _alCambiarHover() {
        const boton = [...this._botones.values()].find(b => b.hover);
        const conVentanas = boton && ventanasAca(boton.app).length > 0;

        if (this._vista.hover || (boton && this._vista.abierta && boton.app === this._vista.app)) {
            this._cancelar();
            return;
        }

        this._cancelar();
        if (boton && conVentanas && !Main.overview.visible && !Main.panel.menuManager.activeMenu) {
            if (this._vista.abierta) {
                this._vista.mostrar(boton.app);
                this._porClic = false;
            } else {
                this._apertura = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEMORA_APERTURA_MS, () => {
                    this._apertura = 0;
                    // El botón pudo desaparecer si la app se cerró mientras tanto
                    if (this._botones.get(boton.app) === boton && boton.hover) {
                        this._vista.mostrar(boton.app);
                        this._porClic = false;
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        } else if (this._vista.abierta) {
            this._cierre = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEMORA_CIERRE_MS, () => {
                this._cierre = 0;
                this._vista.cerrar();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _cerrarVista() {
        this._cancelar();
        this._vista.cerrar();
    }

    _cancelar() {
        if (this._apertura)
            GLib.source_remove(this._apertura);
        if (this._cierre)
            GLib.source_remove(this._cierre);
        this._apertura = 0;
        this._cierre = 0;
    }
});
