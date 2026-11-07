// Contenido del menú del sistema de GNOME, como en el diseño: "Sistema" a la
// izquierda de los botones (captura, configuración, bloquear, apagar), todos
// juntos a la derecha, y el porcentaje a la derecha de cada slider. La
// batería sale de esa fila: ya se ve en la isla compacta.
//
// Todo se deshace en destroy(): el menú es de GNOME.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

export class Sistema {
    constructor(menu) {
        this._grilla = menu._grid;
        this._porcentajes = new Map();

        // GNOME arma el menú de a poco (también después de que Riel se
        // activa): cada elemento se prepara cuando aparece
        const preparar = hijo => {
            this._prepararFila(hijo);
            this._agregarPorcentaje(hijo);
        };
        this._grilla.get_children().forEach(preparar);
        this._grilla.connectObject('child-added', (_g, hijo) => preparar(hijo), this);
    }

    // Fila de arriba: GNOME prende y apaga la batería (y con ella los
    // espaciadores) según haya batería; acá se mantienen ocultos
    _prepararFila(hijo) {
        if (this._fila || !hijo.powerToggle)
            return;
        this._fila = hijo;
        this._ocultos = [hijo.powerToggle, hijo._laptopSpacer, hijo._desktopSpacer].filter(Boolean);
        for (const actor of this._ocultos) {
            actor.hide();
            actor.connectObject('notify::visible', () => actor.visible && actor.hide(), this);
        }
        this._titulo = new St.Label({
            text: 'Sistema',
            style_class: 'riel-sistema-titulo',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        hijo.child.insert_child_at_index(this._titulo, 0);
    }

    _agregarPorcentaje(item) {
        const slider = item.slider;
        if (!slider || this._porcentajes.has(item))
            return;
        const etiqueta = new St.Label({style_class: 'riel-sistema-porcentaje', y_align: Clutter.ActorAlign.CENTER});
        const actualizar = () => (etiqueta.text = `${Math.round(slider.value * 100)}%`);
        slider.connectObject('notify::value', actualizar, this);
        actualizar();
        // Después del slider, antes del botón de su menú (si tiene)
        const contenedor = slider.get_parent();
        const caja = contenedor.get_parent();
        caja.insert_child_above(etiqueta, contenedor);
        this._porcentajes.set(item, {etiqueta, slider});
    }

    destroy() {
        this._grilla.disconnectObject(this);
        for (const {etiqueta, slider} of this._porcentajes.values()) {
            slider.disconnectObject(this);
            etiqueta.destroy();
        }
        this._porcentajes.clear();
        // Al soltar, la regla de GNOME: la batería según UPower y los
        // espaciadores detrás (el de laptop igual, el de escritorio al revés)
        this._ocultos?.forEach(actor => actor.disconnectObject(this));
        if (this._fila) {
            const {powerToggle} = this._fila;
            powerToggle._sync?.();
            if (this._fila._laptopSpacer)
                this._fila._laptopSpacer.visible = powerToggle.visible;
            if (this._fila._desktopSpacer)
                this._fila._desktopSpacer.visible = !powerToggle.visible;
        }
        this._titulo?.destroy();
        this._fila = this._ocultos = this._titulo = null;
    }
}
