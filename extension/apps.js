// Isla izquierda: la cuadrícula de aplicaciones, tus apps fijadas y las que
// están abiertas. Reemplaza al botón "Actividades" mientras Riel está activa.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TAMANO_ICONO = 20;

const BotonApp = GObject.registerClass(
class BotonApp extends St.Button {
    _init(app) {
        super._init({
            style_class: 'panel-button riel-app',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            accessible_name: app.get_name(),
            can_focus: true,
        });
        this.app = app;

        // El punto se superpone abajo, sin empujar al ícono: así el ícono
        // queda en el centro exacto del círculo del hover
        const caja = new St.Widget({layout_manager: new Clutter.BinLayout()});
        caja.add_child(app.create_icon_texture(TAMANO_ICONO));
        this._punto = new St.Widget({
            style_class: 'riel-app-punto',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
        });
        caja.add_child(this._punto);
        this.set_child(caja);

        this._menu = null;
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
            return;
        }

        if (numero === Clutter.BUTTON_MIDDLE || ctrl) {
            app.open_new_window(-1);
        } else if (app.state === Shell.AppState.RUNNING &&
                   Shell.WindowTracker.get_default().focus_app === app) {
            // Clic sobre la app que ya está al frente: se esconde
            app.get_windows().forEach(ventana => ventana.minimize());
        } else {
            app.activate();
        }
        Main.overview.hide();
    }

    actualizar() {
        const abierta = this.app.state !== Shell.AppState.STOPPED;
        const enfocada = Shell.WindowTracker.get_default().focus_app === this.app;
        this._punto.opacity = abierta ? 255 : 0;
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
                this._botones.set(app, boton);
                this._lista.add_child(boton);
            }
            this._lista.set_child_at_index(boton, indice);
            boton.actualizar();
        });
    }
});
