// Isla central: hora grande y fecha corta ("16:42 | Sáb 31 oct"). El clic
// expande la isla con el carrusel (Música, Calendario).
//
// Es un botón del panel con su propio menú, así GNOME se encarga de cerrarlo
// con un clic afuera o Esc, y de que haya un solo menú del panel abierto a
// la vez (abrir el carrusel cierra el menú del sistema y viceversa). El
// botón de fecha de GNOME queda oculto mientras Riel está activa.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {Carrusel, PaginaCalendario} from './carrusel.js';
import {Esquina} from './islas.js';

export const Reloj = GObject.registerClass(
class Reloj extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Reloj');
        this.add_style_class_name('riel-reloj-boton');

        const caja = new St.BoxLayout({style_class: 'riel-reloj', y_align: Clutter.ActorAlign.CENTER});
        this._hora = new St.Label({style_class: 'riel-hora', y_align: Clutter.ActorAlign.CENTER});
        this._fecha = new St.Label({style_class: 'riel-fecha', y_align: Clutter.ActorAlign.CENTER});
        caja.add_child(this._hora);
        caja.add_child(new St.Widget({style_class: 'riel-separador', y_align: Clutter.ActorAlign.CENTER}));
        caja.add_child(this._fecha);
        this.add_child(caja);

        // La isla expandida: el menú se dibuja pegado abajo de la isla
        this.menu.actor.add_style_class_name('riel-centro');
        this._carrusel = new Carrusel([new PaginaCalendario()]);
        this.menu.box.add_child(this._carrusel);
        this._uniones = new Uniones(this.menu);
        this.menu.connectObject('open-state-changed', (_menu, abierto) => {
            if (abierto) {
                this._carrusel.alAbrir();
                Main.panel._centerBox.add_style_pseudo_class('expandida');
            } else {
                this._carrusel.alCerrar();
                Main.panel._centerBox.remove_style_pseudo_class('expandida');
            }
        }, this);

        this._ajustes = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._ajustes.connectObject('changed::clock-format', () => this._actualizar(), this);
        // Avisa cada minuto (o cada segundo si GNOME muestra segundos)
        this._reloj = new GnomeDesktop.WallClock();
        this._reloj.connectObject('notify::clock', () => this._actualizar(), this);
        this._actualizar();
    }

    _actualizar() {
        const ahora = GLib.DateTime.new_now_local();
        const formato = this._ajustes.get_string('clock-format') === '12h' ? '%-I:%M %p' : '%H:%M';
        this._hora.text = ahora.format(formato);
        const fecha = ahora.format('%a %-d %b');
        this._fecha.text = fecha.charAt(0).toUpperCase() + fecha.slice(1);
    }

    destroy() {
        this._reloj.disconnectObject(this);
        this._ajustes.disconnectObject(this);
        this._reloj = null;
        this._ajustes = null;
        this._uniones.destroy();
        Main.panel._centerBox.remove_style_pseudo_class('expandida');
        super.destroy();
    }
});

// Las dos esquinas cóncavas donde la isla expandida, más ancha que la isla
// del reloj, se une con ella. Viven en la capa de la interfaz y se ubican al
// abrir el menú; el menú en sí no deja dibujar fuera de su caja.
class Uniones {
    constructor(menu) {
        this._menu = menu;
        this._izquierda = new Esquina('union-izq');
        this._derecha = new Esquina('union');
        this._capa = new St.Widget({style_class: 'riel-vista-raiz', visible: false});
        this._capa.add_child(this._izquierda);
        this._capa.add_child(this._derecha);
        Main.layoutManager.addTopChrome(this._capa);

        menu.connectObject('open-state-changed', (_menu, abierto) => {
            if (abierto)
                this._ubicar();
            else
                this._capa.hide();
        }, this);
        menu.actor.connectObject('notify::allocation', () => {
            if (menu.isOpen)
                this._ubicar();
        }, this);
    }

    _ubicar() {
        const isla = Main.panel._centerBox;
        const [xIsla, yIsla] = isla.get_transformed_position();
        const contenido = this._menu.box;
        const [xMenu] = contenido.get_transformed_position();
        const anchoMenu = contenido.width;
        const lado = this._derecha.width;
        const abajo = yIsla + isla.height - lado;

        // Solo hacen falta si el menú sobresale de la isla por los costados
        const sobresale = xMenu < xIsla && xMenu + anchoMenu > xIsla + isla.width;
        this._capa.visible = sobresale;
        if (!sobresale)
            return;
        this._izquierda.set_position(Math.round(xIsla - lado), Math.round(abajo));
        this._derecha.set_position(Math.round(xIsla + isla.width), Math.round(abajo));
    }

    destroy() {
        this._menu.disconnectObject(this);
        this._menu.actor.disconnectObject(this);
        Main.layoutManager.removeChrome(this._capa);
        this._capa.destroy();
    }
}
