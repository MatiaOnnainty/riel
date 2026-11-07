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
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {PaginaCalendario} from './calendario.js';
import {Carrusel} from './carrusel.js';
import {PaginaMusica} from './musica.js';
import {Esquina} from './islas.js';

// Aparición de la isla expandida: el fondo crece desde la isla del reloj y
// el contenido se funde apenas después; al cerrar, lo inverso y más rápido
const CRECER_MS = 180;
const FUNDIR_MS = 150;
const DEMORA_CONTENIDO_MS = 60;
const CERRAR_MS = 120;
const ALTO_INICIAL = 0.7;

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

        // La isla expandida: el menú crece desde el borde de arriba y tapa la
        // isla del reloj (su encabezado repite fecha y hora)
        this.menu.actor.add_style_class_name('riel-centro');
        this._carrusel = new Carrusel([new PaginaMusica(), new PaginaCalendario()]);
        this.menu.box.add_child(this._carrusel);
        this._animarAparicion();
        this._uniones = new Alas(this.menu);
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

    // Reemplaza el fundido de GNOME (todo el menú semitransparente, con la
    // isla del reloj y las esquinas viéndose negras a través) por una isla
    // opaca que crece y un contenido que se funde. Solo escala y opacidad:
    // lo más barato de animar. Sin animaciones en GNOME, ease() termina al
    // instante.
    _animarAparicion() {
        const menu = this.menu;
        const fondo = menu.box;
        const contenido = this._carrusel;
        const abrir = menu.open.bind(menu);
        const cerrar = menu.close.bind(menu);
        let cerrando = false;

        fondo.set_pivot_point(0.5, 0);
        menu.open = () => {
            if (menu.isOpen && !cerrando)
                return;
            fondo.remove_all_transitions();
            contenido.remove_all_transitions();
            if (cerrando) {
                // Se volvió a abrir mientras se cerraba: queda abierta
                cerrando = false;
                fondo.scale_y = 1;
                contenido.opacity = 255;
                return;
            }
            fondo.scale_y = ALTO_INICIAL;
            contenido.opacity = 0;
            abrir(BoxPointer.PopupAnimation.NONE);
            // Clutter no anima un actor que todavía no está en pantalla
            // (pasaría directo al final): se espera a que lo esté
            const animar = () => {
                fondo.ease({scale_y: 1, duration: CRECER_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                contenido.ease({
                    opacity: 255,
                    delay: DEMORA_CONTENIDO_MS,
                    duration: FUNDIR_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            };
            if (fondo.mapped) {
                animar();
            } else {
                const id = fondo.connect('notify::mapped', () => {
                    fondo.disconnect(id);
                    animar();
                });
            }
        };
        // Sin animación pedida (al destruir, al abrirse algo modal) cierra
        // en el acto
        menu.close = animar => {
            if (!menu.isOpen || cerrando)
                return;
            if (!animar) {
                fondo.remove_all_transitions();
                contenido.remove_all_transitions();
                cerrar(BoxPointer.PopupAnimation.NONE);
                return;
            }
            cerrando = true;
            contenido.ease({opacity: 0, duration: CERRAR_MS, mode: Clutter.AnimationMode.EASE_IN_QUAD});
            fondo.ease({
                scale_y: ALTO_INICIAL,
                duration: CERRAR_MS,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (!cerrando)
                        return;
                    cerrando = false;
                    cerrar(BoxPointer.PopupAnimation.NONE);
                    fondo.scale_y = 1;
                    contenido.opacity = 255;
                },
            });
        };
    }

    // Formato de hora según GNOME (24 o 12 horas); también lo usa el
    // encabezado de las páginas
    get formatoHora() {
        return this._ajustes.get_string('clock-format') === '12h' ? '%-I:%M %p' : '%H:%M';
    }

    _actualizar() {
        const ahora = GLib.DateTime.new_now_local();
        this._hora.text = ahora.format(this.formatoHora);
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

// Las dos esquinas cóncavas donde la isla expandida, que crece desde el
// borde de arriba tapando la isla del reloj, se une con el borde de la
// pantalla (como las de las islas). Viven en la capa de la interfaz y se
// ubican al abrir el menú: el menú en sí no deja dibujar fuera de su caja.
class Alas {
    constructor(menu) {
        this._menu = menu;
        this._izquierda = new Esquina('inicio');
        this._derecha = new Esquina('final');
        // La capa abarca justo las dos esquinas y no toma clics: lo de abajo
        // (el panel, las ventanas) sigue respondiendo
        this._capa = new St.Widget({style_class: 'riel-vista-raiz', visible: false});
        this._capa.add_child(this._izquierda);
        this._capa.add_child(this._derecha);
        Main.layoutManager.addTopChrome(this._capa, {affectsInputRegion: false});

        // Se ubica justo antes de dibujar, no en medio del cálculo de
        // posiciones del menú: ahí no se puede mostrar otro actor
        this._pendiente = 0;
        const programar = () => {
            if (this._pendiente)
                return;
            this._pendiente = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._pendiente = 0;
                if (menu.isOpen)
                    this._ubicar();
                return GLib.SOURCE_REMOVE;
            });
        };
        menu.connectObject('open-state-changed', (_menu, abierto) => {
            if (abierto)
                programar();
            else
                this._capa.hide();
        }, this);
        menu.actor.connectObject('notify::allocation', () => {
            if (menu.isOpen)
                programar();
        }, this);
    }

    // La capa va de una esquina a la otra; cada esquina se corre sola hacia
    // afuera su propio ancho (ver Esquina). Recién al abrir, el menú todavía
    // no tiene posición (NaN): se espera a su primera ubicación real
    _ubicar() {
        const contenido = this._menu.box;
        const [x, y] = contenido.get_transformed_position();
        const [, lado] = this._derecha.get_preferred_width(-1);
        const ancho = contenido.width;
        if (![x, y, lado, ancho].every(Number.isFinite) || !lado || !ancho)
            return;
        this._capa.set_position(Math.round(x - lado), Math.round(y));
        this._capa.set_size(Math.round(ancho + 2 * lado), lado);
        this._izquierda.set_position(lado, 0);
        this._derecha.set_position(Math.round(ancho), 0);
        this._capa.show();
    }

    destroy() {
        if (this._pendiente)
            global.compositor.get_laters().remove(this._pendiente);
        this._menu.disconnectObject(this);
        this._menu.actor.disconnectObject(this);
        Main.layoutManager.removeChrome(this._capa);
        this._capa.destroy();
    }
}
