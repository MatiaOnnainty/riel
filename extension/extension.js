// Riel: el panel superior como tres islas pegadas al borde.
//
// Cada parte vive en su módulo y se arma en enable() y se desarma en
// disable(), dejando el panel exactamente como estaba.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Apps} from './apps.js';
import {IslaExpandida} from './islaExpandida.js';
import {Islas} from './islas.js';
import {Recursos} from './recursos.js';
import {Sistema} from './sistema.js';
import {Reloj} from './reloj.js';

export default class Riel extends Extension {
    enable() {
        this._islas = new Islas();

        this._actividades = Main.panel.statusArea.activities?.container;
        this._actividades?.hide();
        this._apps = new Apps();
        Main.panel._leftBox.insert_child_at_index(this._apps, 0);

        // El reloj de Riel reemplaza al botón de fecha de GNOME
        this._fecha = Main.panel.statusArea.dateMenu?.container;
        this._fecha?.hide();
        this._reloj = new Reloj();
        Main.panel.addToStatusArea('riel-reloj', this._reloj, 0, 'center');
        // Super+V y "cerrar el calendario" (al activar una ventana) apuntan
        // al botón de fecha de GNOME, que está oculto: pasan al de Riel
        Main.panel.toggleCalendar = () => Main.panel._toggleMenu(this._reloj);
        Main.panel.closeCalendar = () => Main.panel._closeMenu(this._reloj);

        // CPU y RAM al principio de la isla derecha (después de su esquina),
        // antes de los íconos de bandeja que otras extensiones agregan al
        // principio de la caja
        this._recursos = new Recursos();
        const derecha = Main.panel._rightBox;
        derecha.insert_child_at_index(this._recursos, 1);
        derecha.connectObject('child-added', () => {
            if (derecha.get_child_at_index(1) !== this._recursos)
                derecha.set_child_at_index(this._recursos, 1);
        }, this._recursos);

        // El menú del sistema de GNOME, como isla expandida que cuelga de la
        // isla derecha: la fila de estado (CPU, RAM, bandeja…) sigue arriba.
        // Toca el borde de la pantalla: solo lleva unión a la izquierda
        this._sistema = new IslaExpandida(Main.panel.statusArea.quickSettings.menu, {
            caja: derecha,
            lados: ['izquierda'],
            cubrir: false,
        });
        this._contenidoSistema = new Sistema(Main.panel.statusArea.quickSettings.menu);
    }

    disable() {
        this._contenidoSistema?.destroy();
        this._contenidoSistema = null;
        this._sistema?.destroy();
        this._sistema = null;
        this._recursos?.destroy();
        this._recursos = null;

        // Sin estas copias propias vuelven los métodos originales del panel
        delete Main.panel.toggleCalendar;
        delete Main.panel.closeCalendar;
        this._reloj?.destroy();
        this._reloj = null;
        this._fecha?.show();
        this._fecha = null;

        this._apps?.destroy();
        this._apps = null;
        this._actividades?.show();
        this._actividades = null;

        this._islas?.destroy();
        this._islas = null;
    }
}
