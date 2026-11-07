// Riel: el panel superior como tres islas pegadas al borde.
//
// Cada parte vive en su módulo y se arma en enable() y se desarma en
// disable(), dejando el panel exactamente como estaba.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Apps} from './apps.js';
import {IslaExpandida} from './islaExpandida.js';
import {Islas} from './islas.js';
import {Recursos} from './recursos.js';
import {Sistema} from './sistema.js';
import {Reloj} from './reloj.js';

const DOCK = 'ubuntu-dock@ubuntu.com';
const ATAJOS = [['atajo-panel-siguiente', 1], ['atajo-panel-anterior', -1]];

export default class Riel extends Extension {
    enable() {
        this._ajustes = this.getSettings();
        this._islas = new Islas();

        this._actividades = Main.panel.statusArea.activities?.container;
        this._actividades?.hide();
        this._apps = new Apps();
        Main.panel._leftBox.insert_child_at_index(this._apps, 0);

        // El reloj de Riel reemplaza al botón de fecha de GNOME
        this._fecha = Main.panel.statusArea.dateMenu?.container;
        this._fecha?.hide();
        this._reloj = new Reloj(this._ajustes);
        Main.panel.addToStatusArea('riel-reloj', this._reloj, 0, 'center');
        // Super+V y "cerrar el calendario" (al activar una ventana) apuntan
        // al botón de fecha de GNOME, que está oculto: pasan al de Riel
        Main.panel.toggleCalendar = () => Main.panel._toggleMenu(this._reloj);
        Main.panel.closeCalendar = () => Main.panel._closeMenu(this._reloj);

        // CPU y RAM al principio de la isla derecha (después de su esquina),
        // antes de los íconos de bandeja que otras extensiones agregan al
        // principio de la caja
        this._recursos = new Recursos(this._ajustes);
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

        // Preferencias: letra, Ubuntu Dock y atajos
        this._ajustes.connectObject(
            'changed::escala-fuente', () => this._aplicarFuente(),
            'changed::fuente', () => this._aplicarFuente(),
            'changed::ocultar-dock', () => this._aplicarDock(), this);
        this._aplicarFuente();
        this._aplicarDock();
        // Los atajos funcionan también con la isla abierta (modo popup)
        for (const [clave, paso] of ATAJOS) {
            Main.wm.addKeybinding(clave, this._ajustes, Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP | Shell.ActionMode.OVERVIEW,
                () => this._reloj.cambiarPanel(paso));
        }
    }

    // Tamaño y tipografía de las islas: el panel y las islas expandidas (que
    // viven fuera del panel y no heredan su letra). Se guarda el estilo que
    // tenía cada uno para devolverlo
    _aplicarFuente() {
        const escala = this._ajustes.get_int('escala-fuente');
        const familia = this._ajustes.get_string('fuente').replace(/["\\;{}]/g, '');
        const estilo = [
            escala !== 100 ? `font-size: ${(escala / 100).toFixed(2)}em;` : '',
            familia ? `font-family: "${familia}";` : '',
        ].join(' ').trim();
        this._estilosOriginales ??= new Map();
        const actores = [
            Main.panel,
            this._reloj.menu.box,
            Main.panel.statusArea.quickSettings.menu.box,
            this._apps._vista,
        ];
        for (const actor of actores) {
            if (!this._estilosOriginales.has(actor))
                this._estilosOriginales.set(actor, actor.get_style());
            const original = this._estilosOriginales.get(actor) ?? '';
            actor.set_style(`${original} ${estilo}`.trim() || null);
        }
    }

    _restaurarFuente() {
        for (const [actor, estilo] of this._estilosOriginales ?? [])
            actor.set_style(estilo);
        this._estilosOriginales = null;
    }

    // Ubuntu Dock: se apaga y se enciende con el gestor de extensiones de
    // GNOME (reversible). Solo se vuelve a encender si lo apagó Riel
    _aplicarDock() {
        const gestor = Main.extensionManager;
        if (!gestor.lookup(DOCK))
            return;
        const ocultar = this._ajustes.get_boolean('ocultar-dock');
        if (ocultar && gestor._enabledExtensions.includes(DOCK)) {
            gestor.disableExtension(DOCK);
            this._ajustes.set_boolean('dock-ocultado', true);
        } else if (!ocultar && this._ajustes.get_boolean('dock-ocultado')) {
            this._encenderDock();
        }
    }

    _encenderDock() {
        Main.extensionManager.enableExtension(DOCK);
        this._ajustes.set_boolean('dock-ocultado', false);
    }

    disable() {
        for (const [clave] of ATAJOS)
            Main.wm.removeKeybinding(clave);
        this._ajustes?.disconnectObject(this);
        // Al bloquear la pantalla GNOME desactiva las extensiones: el dock
        // sigue oculto. Solo al desactivar Riel de verdad vuelve
        if (this._ajustes?.get_boolean('dock-ocultado') && !Main.sessionMode.isLocked)
            this._encenderDock();
        this._restaurarFuente();

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
        this._ajustes = null;
    }
}
