// Convierte el menú de un botón del panel en la isla expandida, del mismo
// color que su isla, de dos formas:
//  - cubrir: crece desde el borde de arriba tapando la isla, con esquinas
//    cóncavas contra el borde de la pantalla (el reloj: sus páginas repiten
//    la hora);
//  - colgar: crece pegado debajo de la isla, que sigue a la vista, con
//    esquinas cóncavas en el ángulo donde se ensancha (el menú del sistema:
//    la fila de estado queda arriba, como en el diseño).
//
// Reemplaza el fundido de GNOME (todo el menú semitransparente, con la isla
// de abajo y las esquinas viéndose negras a través) por un fondo opaco que
// crece y un contenido que se funde. Solo escala y opacidad: lo más barato
// de animar. Sin animaciones en GNOME, ease() termina al instante.
//
// destroy() deja el menú como estaba (el del sistema es de GNOME).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Esquina} from './islas.js';

// El fondo crece desde la isla y el contenido se funde apenas después; al
// cerrar, lo inverso y más rápido
const CRECER_MS = 180;
const FUNDIR_MS = 150;
const DEMORA_CONTENIDO_MS = 60;
const CERRAR_MS = 120;
const ALTO_INICIAL = 0.7;

export class IslaExpandida {
    // caja: la caja del panel que es la isla (recibe :expandida mientras
    // está abierta). contenido: lo que se funde (por defecto, el fondo
    // entero). lados: dónde va esquina ('izquierda', 'derecha').
    // alAlternar(): si devuelve true, el clic ya se usó para otra cosa.
    // cubrir: false para colgar debajo de la isla.
    constructor(menu, {caja, contenido = null, lados = ['izquierda', 'derecha'], cubrir = true, alAlternar = () => false}) {
        this._menu = menu;
        this._caja = caja;
        this._fondo = menu.box;
        this._contenido = contenido ?? menu.box;
        this._alAlternar = alAlternar;
        this._cerrando = false;

        this._clase = cubrir ? 'riel-isla-expandida' : 'riel-isla-colgante';
        menu._boxPointer.add_style_class_name(this._clase);
        this._fondo.set_pivot_point(0.5, 0);
        this._reemplazarAnimacion();
        this._alas = new Alas(menu, lados, cubrir ? null : caja);
        menu.connectObject('open-state-changed', (_menu, abierto) => {
            if (abierto)
                caja.add_style_pseudo_class('expandida');
            else
                caja.remove_style_pseudo_class('expandida');
        }, this);
    }

    _reemplazarAnimacion() {
        const menu = this._menu;
        const fondo = this._fondo;
        const contenido = this._contenido;
        const abrir = menu.open.bind(menu);
        const cerrar = menu.close.bind(menu);

        menu.open = () => {
            if (menu.isOpen && !this._cerrando)
                return;
            fondo.remove_all_transitions();
            contenido.remove_all_transitions();
            if (this._cerrando) {
                // Se volvió a abrir mientras se cerraba: queda abierta
                this._cerrando = false;
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
                    delay: contenido === fondo ? 0 : DEMORA_CONTENIDO_MS,
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
        // Clic o atajo mientras se está cerrando: vuelve a abrir
        menu.toggle = () => {
            if (this._alAlternar())
                return;
            if (menu.isOpen && !this._cerrando)
                menu.close(BoxPointer.PopupAnimation.FULL);
            else
                menu.open();
        };
        // Sin animación pedida (al destruir, al abrirse algo modal) cierra
        // en el acto
        menu.close = animar => {
            if (!menu.isOpen || this._cerrando)
                return;
            if (!animar) {
                fondo.remove_all_transitions();
                contenido.remove_all_transitions();
                fondo.scale_y = 1;
                contenido.opacity = 255;
                cerrar(BoxPointer.PopupAnimation.NONE);
                return;
            }
            this._cerrando = true;
            contenido.ease({opacity: 0, duration: CERRAR_MS, mode: Clutter.AnimationMode.EASE_IN_QUAD});
            fondo.ease({
                scale_y: ALTO_INICIAL,
                duration: CERRAR_MS,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (!this._cerrando)
                        return;
                    this._cerrando = false;
                    cerrar(BoxPointer.PopupAnimation.NONE);
                    fondo.scale_y = 1;
                    contenido.opacity = 255;
                },
            });
        };
    }

    destroy() {
        const menu = this._menu;
        if (menu.isOpen)
            menu.close();
        // Sin estas copias propias vuelven los métodos del menú
        delete menu.open;
        delete menu.close;
        delete menu.toggle;
        this._fondo.remove_all_transitions();
        this._contenido.remove_all_transitions();
        this._fondo.scale_y = 1;
        this._contenido.opacity = 255;
        menu._boxPointer.remove_style_class_name(this._clase);
        menu.disconnectObject(this);
        this._caja.remove_style_pseudo_class('expandida');
        this._alas.destroy();
    }
}

// Las esquinas cóncavas de la isla expandida: contra el borde de la
// pantalla si cubre la isla, o en el ángulo donde se ensancha por debajo de
// la isla si cuelga (caja). Viven en la capa de la interfaz y se ubican al
// abrir el menú: el menú en sí no deja dibujar fuera de su caja.
class Alas {
    constructor(menu, lados, caja) {
        this._menu = menu;
        this._caja = caja;
        const formas = caja ? ['union-izq', 'union'] : ['inicio', 'final'];
        this._izquierda = lados.includes('izquierda') ? new Esquina(formas[0]) : null;
        this._derecha = lados.includes('derecha') ? new Esquina(formas[1]) : null;
        // La capa abarca justo las esquinas y no toma clics: lo de abajo
        // (el panel, las ventanas) sigue respondiendo
        this._capa = new St.Widget({style_class: 'riel-vista-raiz', visible: false});
        for (const esquina of [this._izquierda, this._derecha].filter(Boolean))
            this._capa.add_child(esquina);
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
        menu._boxPointer.connectObject('notify::allocation', () => {
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
        const [, lado] = (this._izquierda ?? this._derecha).get_preferred_width(-1);
        const ancho = contenido.width;
        if (![x, y, lado, ancho].every(Number.isFinite) || !lado || !ancho)
            return;
        if (this._caja) {
            this._ubicarUniones(x, ancho, lado);
            return;
        }
        this._capa.set_position(Math.round(x - lado), Math.round(y));
        this._capa.set_size(Math.round(ancho + 2 * lado), lado);
        this._izquierda?.set_position(lado, 0);
        this._derecha?.set_position(Math.round(ancho), 0);
        this._capa.show();
    }

    // Colgando: cada unión va en el ángulo entre el borde de la isla y el
    // borde de arriba del menú, solo si el menú sobresale de ese lado
    _ubicarUniones(xMenu, anchoMenu, lado) {
        const [xIsla, yIsla] = this._caja.get_transformed_position();
        const anchoIsla = this._caja.width;
        const abajo = yIsla + this._caja.height - lado;
        if (![xIsla, yIsla, anchoIsla].every(Number.isFinite))
            return;
        this._capa.set_position(Math.round(xIsla - lado), Math.round(abajo));
        this._capa.set_size(Math.round(anchoIsla + 2 * lado), lado);
        if (this._izquierda) {
            this._izquierda.visible = xMenu < xIsla - 1;
            this._izquierda.set_position(0, 0);
        }
        if (this._derecha) {
            this._derecha.visible = xMenu + anchoMenu > xIsla + anchoIsla + 1;
            this._derecha.set_position(Math.round(anchoIsla + lado), 0);
        }
        this._capa.show();
    }

    destroy() {
        if (this._pendiente)
            global.compositor.get_laters().remove(this._pendiente);
        this._menu.disconnectObject(this);
        this._menu._boxPointer.disconnectObject(this);
        Main.layoutManager.removeChrome(this._capa);
        this._capa.destroy();
    }
}
