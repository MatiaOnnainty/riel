// Convierte el panel superior en tres islas pegadas al borde de arriba.
//
// Cada caja del panel (izquierda, centro, derecha) es una isla: el fondo y
// los bordes redondeados de abajo salen de stylesheet.css. Lo que el CSS de
// St no puede dibujar son las esquinas cóncavas donde la isla se une al borde
// de la pantalla; esas las dibuja Esquina con Cairo.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Esquina cóncava en un extremo de la isla ('inicio' o 'final'). Ocupa su
// lugar dentro de la caja, como si fuera padding, y se dibuja desplazada
// hacia afuera. El color y el tamaño vienen de .riel-esquina en
// stylesheet.css.
const Esquina = GObject.registerClass(
class Esquina extends St.DrawingArea {
    _init(extremo) {
        super._init({style_class: 'riel-esquina', y_align: Clutter.ActorAlign.START});
        this._extremo = extremo;
        this.connect('notify::width', () => {
            this.translation_x = extremo === 'inicio' ? -this.width : this.width;
        });
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [ancho, alto] = this.get_surface_size();

        // Relleno entre el borde de la isla, el borde de la pantalla (y = 0)
        // y un cuarto de círculo con centro en la esquina de abajo, del lado
        // opuesto a la isla
        if (this._extremo === 'final') {
            cr.moveTo(0, 0);
            cr.lineTo(ancho, 0);
            cr.arcNegative(ancho, alto, ancho, 3 * Math.PI / 2, Math.PI);
        } else {
            cr.moveTo(ancho, 0);
            cr.lineTo(0, 0);
            cr.arc(0, alto, ancho, 3 * Math.PI / 2, 2 * Math.PI);
        }
        cr.closePath();

        const {red, green, blue, alpha} = this.get_theme_node().get_foreground_color();
        cr.setSourceRGBA(red / 255, green / 255, blue / 255, alpha / 255);
        cr.fill();
        cr.$dispose();
    }
});

export class Islas {
    constructor() {
        const panel = Main.panel;
        panel.add_style_class_name('riel');

        // Las cajas recortan lo que se dibuja fuera de ellas, y las esquinas
        // quedan justo afuera
        this._cajas = [panel._leftBox, panel._centerBox, panel._rightBox];
        this._cajas.forEach(caja => (caja.clip_to_view = false));

        this._esquinas = [
            [panel._leftBox, 'final'],
            [panel._centerBox, 'inicio'],
            [panel._centerBox, 'final'],
            [panel._rightBox, 'inicio'],
        ].map(([caja, extremo]) => {
            const esquina = new Esquina(extremo);
            caja.add_child(esquina);
            this._fijar(caja, esquina, extremo);
            // Otras extensiones agregan indicadores en cualquier posición
            caja.connectObject('child-added',
                () => this._fijar(caja, esquina, extremo), esquina);
            return esquina;
        });
    }

    _fijar(caja, esquina, extremo) {
        const indice = extremo === 'inicio' ? 0 : caja.get_n_children() - 1;
        if (caja.get_child_at_index(indice) !== esquina)
            caja.set_child_at_index(esquina, indice);
    }

    destroy() {
        this._esquinas.forEach(esquina => esquina.destroy());
        this._esquinas = [];
        this._cajas.forEach(caja => (caja.clip_to_view = true));
        Main.panel.remove_style_class_name('riel');
    }
}
