// Riel: el panel superior como tres islas pegadas al borde.
//
// Cada parte vive en su módulo y se arma en enable() y se desarma en
// disable(), dejando el panel exactamente como estaba.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Apps} from './apps.js';
import {Islas} from './islas.js';
import {Reloj} from './reloj.js';

export default class Riel extends Extension {
    enable() {
        this._islas = new Islas();

        this._actividades = Main.panel.statusArea.activities?.container;
        this._actividades?.hide();
        this._apps = new Apps();
        Main.panel._leftBox.insert_child_at_index(this._apps, 0);

        this._reloj = new Reloj();
    }

    disable() {
        this._reloj?.destroy();
        this._reloj = null;

        this._apps?.destroy();
        this._apps = null;
        this._actividades?.show();
        this._actividades = null;

        this._islas?.destroy();
        this._islas = null;
    }
}
