// Isla izquierda expandida: debajo de la isla aparecen las ventanas abiertas
// de una app, como miniaturas en vivo. Clic en una miniatura trae esa ventana.
//
// La vista se dibuja pegada a la isla: la isla pierde su borde redondeado de
// abajo y, si la vista es más ancha que la isla, una Esquina 'union' suaviza
// el ángulo entre las dos.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Esquina} from './islas.js';

const ANCHO_MINIATURA = 160;
const ALTO_MINIATURA = 100;
const DURACION_MS = 180;

// Ventanas de la app que cuentan para la barra en el escritorio actual (sin
// diálogos auxiliares ni ventanas ocultas de la barra de tareas), la más
// reciente primero. Lo usan el clic, el cursor y la vista: el mismo criterio
export function ventanasAca(app) {
    const escritorio = global.workspace_manager.get_active_workspace();
    return app.get_windows().filter(ventana =>
        !ventana.skip_taskbar && ventana.located_on_workspace(escritorio));
}

const Miniatura = GObject.registerClass(
class Miniatura extends St.Button {
    _init(ventana) {
        super._init({
            style_class: 'riel-miniatura',
            can_focus: true,
            accessible_name: ventana.get_title() ?? '',
        });
        this.ventana = ventana;

        const caja = new St.BoxLayout({vertical: true});
        const marco = new St.Widget({
            style_class: 'riel-miniatura-marco',
            layout_manager: new Clutter.BinLayout(),
            width: ANCHO_MINIATURA,
            height: ALTO_MINIATURA,
        });
        // Clon en vivo del actor de la ventana; funciona también minimizada,
        // como en Alt+Tab
        const actor = ventana.get_compositor_private();
        if (actor) {
            const clon = new Clutter.Clone({
                source: actor,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
                reactive: false,
            });
            marco.add_child(clon);
            // Si la ventana cambia de tamaño (maximizar…), la miniatura también
            const escalar = () => {
                const [ancho, alto] = actor.get_size();
                const escala = Math.min(1, ANCHO_MINIATURA / ancho, ALTO_MINIATURA / alto);
                clon.set_size(ancho * escala, alto * escala);
            };
            actor.connectObject('notify::size', escalar, this);
            escalar();
        }
        caja.add_child(marco);

        this._titulo = new St.Label({
            style_class: 'riel-miniatura-titulo',
            width: ANCHO_MINIATURA,
            reactive: false,
        });
        this._titulo.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        caja.add_child(this._titulo);
        this.set_child(caja);

        ventana.connectObject('notify::title', () => this._actualizarTitulo(), this);
        this._actualizarTitulo();
    }

    _actualizarTitulo() {
        this._titulo.text = this.ventana.get_title() ?? '';
        this.accessible_name = this._titulo.text;
    }
});

export const Vista = GObject.registerClass({
    Signals: {'cerrada': {}},
}, class Vista extends St.Widget {
    _init() {
        super._init({style_class: 'riel-vista-raiz', visible: false, reactive: true, track_hover: true});

        this._fondo = new St.BoxLayout({style_class: 'riel-vista'});
        this.add_child(this._fondo);
        this._union = new Esquina('union');
        this.add_child(this._union);
        // La isla cambia de ancho cuando aparece o se va una app
        Main.panel._leftBox.connectObject('notify::width', () => {
            if (this.abierta)
                this._ubicar();
        }, this);

        this._app = null;
        this.abierta = false;

        // Arriba de todo, también del dock
        Main.layoutManager.addTopChrome(this);
    }

    get app() {
        return this._app;
    }

    // Muestra las ventanas de la app; si ya estaba abierta con otra app,
    // cambia el contenido sin volver a animar
    mostrar(app) {
        if (this._app !== app) {
            this._app?.disconnectObject(this);
            this._app = app;
            app.connectObject('windows-changed', () => this._llenar(), this);
        }
        if (!this._llenar())
            return;

        this._ubicar();
        if (this.abierta)
            return;

        this.abierta = true;
        Main.panel._leftBox.add_style_pseudo_class('expandida');
        this.remove_all_transitions();
        // Puede venir de un cierre a medio animar, que la dejó sin reactividad
        this.reactive = true;
        this.show();
        // ease() termina al instante si GNOME tiene las animaciones desactivadas
        this.set({opacity: 0, scale_y: 0.85, pivot_point: new Graphene.Point({x: 0, y: 0})});
        this.ease({
            opacity: 255,
            scale_y: 1,
            duration: DURACION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    cerrar() {
        if (!this.abierta)
            return;
        this.abierta = false;
        this._soltarApp();

        // Los clones y la isla vuelven a su estado al terminar la animación,
        // así se ve el cierre y la vista no captura el cursor mientras tanto
        this.reactive = false;
        const terminar = () => {
            // Si se volvió a abrir durante la animación, no hay nada que deshacer
            if (this.abierta)
                return;
            this.hide();
            this.reactive = true;
            this._fondo.destroy_all_children();
            Main.panel._leftBox.remove_style_pseudo_class('expandida');
            this.emit('cerrada');
        };
        this.ease({
            opacity: 0,
            scale_y: 0.85,
            duration: DURACION_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: terminar,
        });
    }

    _soltarApp() {
        this._app?.disconnectObject(this);
        this._app = null;
    }

    // Devuelve false si la app ya no tiene ventanas (y entonces cierra, o
    // suelta la app si la vista no llegó a abrirse)
    _llenar() {
        this._fondo.destroy_all_children();
        const ventanas = this._app ? ventanasAca(this._app) : [];
        if (!ventanas.length) {
            if (this.abierta)
                this.cerrar();
            else
                this._soltarApp();
            return false;
        }

        for (const ventana of ventanas) {
            const miniatura = new Miniatura(ventana);
            miniatura.connect('clicked', () => {
                Main.activateWindow(ventana);
                this.cerrar();
            });
            this._fondo.add_child(miniatura);
        }
        if (this.abierta)
            this._ubicar();
        return true;
    }

    // Debajo de la isla izquierda y al menos tan ancha como ella
    _ubicar() {
        const isla = Main.panel._leftBox;
        const [x, y] = isla.get_transformed_position();
        const anchoIsla = isla.width;
        this._fondo.min_width = anchoIsla;
        this.set_position(Math.floor(x), Math.floor(y + isla.height));

        // Si sobresale de la isla, su esquina de arriba a la derecha queda
        // contra el fondo de pantalla y se redondea
        const [, anchoVista] = this._fondo.get_preferred_width(-1);
        const ancha = anchoVista > anchoIsla;
        this._union.visible = ancha;
        if (ancha)
            this._fondo.add_style_pseudo_class('ancha');
        else
            this._fondo.remove_style_pseudo_class('ancha');
        this._union.set_position(anchoIsla, -this._union.height);
    }

    destroy() {
        this.abierta = false;
        this._soltarApp();
        this.remove_all_transitions();
        Main.panel._leftBox.remove_style_pseudo_class('expandida');
        Main.layoutManager.removeChrome(this);
        super.destroy();
    }
});
