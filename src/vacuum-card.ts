import { CSSResultGroup, LitElement, PropertyValues, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  hasConfigOrEntityChanged,
  fireEvent,
  HomeAssistant,
  ServiceCallRequest,
} from 'custom-card-helpers';
import get from 'lodash/get';
import localize from './localize';
import styles from './styles.css';
import buildConfig from './config';
import {
  Template,
  VacuumCardAction,
  VacuumCardConfig,
  VacuumEntity,
  HassEntity,
  VacuumEntityState,
  VacuumServiceCallParams,
  VacuumActionParams,
} from './types';
import DEFAULT_IMAGE from './vacuum.svg';

// String in the right side will be replaced by Rollup
const PKG_VERSION = 'PKG_VERSION_VALUE';

console.info(
  `%c VACUUM-CARD %c ${PKG_VERSION}`,
  'color: white; background: blue; font-weight: 700;',
  'color: blue; background: white; font-weight: 700;',
);

if (!customElements.get('ha-icon-button')) {
  customElements.define(
    'ha-icon-button',
    class extends (customElements.get('paper-icon-button') ?? HTMLElement) {},
  );
}

@customElement('vacuum-card')
export class VacuumCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private config!: VacuumCardConfig;
  @state() private requestInProgress = false;
  @state() private thumbUpdater: ReturnType<typeof setInterval> | null = null;

  static get styles(): CSSResultGroup {
    return styles;
  }

  public static async getConfigElement() {
    await import('./editor');
    return document.createElement('vacuum-card-editor');
  }

  static getStubConfig(_: unknown, entities: string[]) {
    const [vacuumEntity] = entities.filter((eid) => eid.startsWith('vacuum'));

    return {
      entity: vacuumEntity ?? '',
    };
  }

  get entity(): VacuumEntity {
    return this.hass.states[this.config.entity] as VacuumEntity;
  }

  get map(): HassEntity | null {
    if (!this.hass || !this.config.map) {
      return null;
    }
    return this.hass.states[this.config.map];
  }

  public setConfig(config: VacuumCardConfig): void {
    this.config = buildConfig(config);
  }

  public getCardSize(): number {
    return this.config.compact_view ? 3 : 8;
  }

  private getWatchedEntities(): string[] {
    const prefix = this.getEntityPrefix();
    const entities = [
      this.config.entity,
      `sensor.${prefix}_status`,
      `sensor.${prefix}_vacuum_error`,
      `sensor.${prefix}_dock_dock_error`,
      `binary_sensor.${prefix}_dock_mop_drying`,
      `binary_sensor.${prefix}_cleaning`,
      `sensor.${prefix}_current_room`,
      `sensor.${prefix}_dock_mop_drying_remaining_time`,
    ];

    if (this.config.battery_entity) {
      entities.push(this.config.battery_entity);
    }

    return entities;
  }

  public shouldUpdate(changedProps: PropertyValues): boolean {
    if (hasConfigOrEntityChanged(this, changedProps, false)) {
      return true;
    }

    // Also update when any watched entity changes
    if (changedProps.has('hass')) {
      const oldHass = changedProps.get('hass') as HomeAssistant | undefined;
      if (oldHass) {
        for (const entityId of this.getWatchedEntities()) {
          const oldState = oldHass.states[entityId]?.state;
          const newState = this.hass.states[entityId]?.state;
          if (oldState !== newState) {
            return true;
          }
        }
      }
    }

    return false;
  }

  protected updated(changedProps: PropertyValues) {
    if (
      changedProps.get('hass') &&
      changedProps.get('hass').states[this.config.entity].state !==
        this.hass.states[this.config.entity].state
    ) {
      this.requestInProgress = false;
    }
  }

  public connectedCallback() {
    super.connectedCallback();
    if (!this.config.compact_view && this.map) {
      this.requestUpdate();
      this.thumbUpdater = setInterval(
        () => this.requestUpdate(),
        this.config.map_refresh * 1000,
      );
    }
  }

  public disconnectedCallback() {
    super.disconnectedCallback();
    if (this.map && this.thumbUpdater) {
      clearInterval(this.thumbUpdater);
    }
  }

  private handleMore(entityId: string = this.entity.entity_id): void {
    fireEvent(
      this,
      'hass-more-info',
      {
        entityId,
      },
      {
        bubbles: false,
        composed: true,
      },
    );
  }

  private callService(action: VacuumCardAction) {
    const { service, service_data, target } = action;
    const [domain, name] = service.split('.');
    this.hass.callService(domain, name, service_data, target);
  }

  private callVacuumService(
    service: ServiceCallRequest['service'],
    params: VacuumServiceCallParams = { request: true },
    options: ServiceCallRequest['serviceData'] = {},
  ) {
    this.hass.callService('vacuum', service, {
      entity_id: this.config.entity,
      ...options,
    });

    if (params.request) {
      this.requestInProgress = true;
      this.requestUpdate();
    }
  }

  private handleVacuumAction(
    action: string,
    params: VacuumActionParams = { request: true },
  ) {
    return () => {
      if (!this.config.actions[action]) {
        return this.callVacuumService(params.defaultService || action, params);
      }

      this.callService(this.config.actions[action]);
    };
  }

  private getAttributes(entity: VacuumEntity) {
    const { status, state } = entity.attributes;

    return {
      ...entity.attributes,
      status: status ?? state ?? entity.state,
    };
  }

  private renderBattery(): Template {
    let battery_level: number | string | undefined;

    if (this.config.battery_entity) {
      const batteryEntity = this.hass.states[this.config.battery_entity];
      battery_level = batteryEntity
        ? Math.round(Number(batteryEntity.state))
        : undefined;
    } else {
      battery_level = this.getAttributes(this.entity).battery_level;
    }

    if (battery_level === undefined) {
      return nothing;
    }

    return html`
      <div class="tip" @click="${() => this.handleMore()}">
        <span class="battery-label">⚡️ ${battery_level}%</span>
      </div>
    `;
  }

  private renderMapOrImage(state: VacuumEntityState): Template {
    if (this.config.compact_view) {
      return nothing;
    }

    if (this.map) {
      return this.map && this.map.attributes.entity_picture
        ? html`
            <img
              class="map"
              src="${this.map.attributes.entity_picture}&v=${Date.now()}"
              @click=${() => this.handleMore(this.config.map)}
            />
          `
        : nothing;
    }

    const src =
      this.config.image === 'default' ? DEFAULT_IMAGE : this.config.image;

    return html`
      <img
        class="vacuum ${state}"
        src="${src}"
        @click="${() => this.handleMore()}"
      />
    `;
  }

  private processValueTemplate(
    rawValue: string | number,
    template?: string,
  ): string | number {
    let value = typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;

    // If not a valid number, return the raw value as-is
    if (isNaN(value)) {
      return rawValue;
    }

    // If no template, just round to integer
    if (!template) {
      return Math.round(value);
    }

    // Parse and apply common Jinja2 filters
    // Handle: {{ value | float(0) | round(1) | int }}
    const filters = template.match(/\|\s*(\w+)(?:\(([^)]*)\))?/g) || [];

    for (const filter of filters) {
      const match = filter.match(/\|\s*(\w+)(?:\(([^)]*)\))?/);
      if (!match) continue;

      const [, filterName, args] = match;

      switch (filterName) {
        case 'float': {
          const defaultVal = args ? parseFloat(args) : 0;
          value = isNaN(value) ? defaultVal : value;
          break;
        }
        case 'int': {
          value = Math.trunc(value);
          break;
        }
        case 'round': {
          const decimals = args ? parseInt(args, 10) : 0;
          value = Number(value.toFixed(decimals));
          break;
        }
        case 'abs': {
          value = Math.abs(value);
          break;
        }
      }
    }

    // Final safety: if result is still a float with many decimals, round it
    if (!Number.isInteger(value)) {
      // Check if the template intended decimal places
      const roundMatch = template.match(/round\((\d+)\)/);
      const intendedDecimals = roundMatch ? parseInt(roundMatch[1], 10) : 0;
      value = Number(value.toFixed(intendedDecimals));
    }

    return value;
  }

  private renderStats(state: VacuumEntityState): Template {
    const statsList =
      this.config.stats[state] || this.config.stats.default || [];

    const stats = statsList.map(
      ({ entity_id, attribute, value_template, unit, subtitle }) => {
        if (!entity_id && !attribute) {
          return nothing;
        }

        let rawValue: string | number = '';

        if (entity_id && attribute) {
          rawValue = get(this.hass.states[entity_id].attributes, attribute);
        } else if (attribute) {
          rawValue = get(this.entity.attributes, attribute);
        } else if (entity_id) {
          rawValue = this.hass.states[entity_id].state;
        } else {
          return nothing;
        }

        const value = this.processValueTemplate(rawValue, value_template);

        return html`
          <div class="stats-block" @click="${() => this.handleMore(entity_id)}">
            <span class="stats-value">${value}</span>
            ${unit}
            <div class="stats-subtitle">${subtitle}</div>
          </div>
        `;
      },
    );

    if (!stats.length) {
      return nothing;
    }

    return html`<div class="stats">${stats}</div>`;
  }

  private renderName(): Template {
    const { friendly_name } = this.getAttributes(this.entity);

    if (!this.config.show_name) {
      return nothing;
    }

    return html` <div class="vacuum-name">${friendly_name}</div> `;
  }

  private getEntityPrefix(): string {
    // Extract prefix from entity like "vacuum.rocky" -> "rocky"
    const entityId = this.config.entity;
    return entityId.split('.')[1] || '';
  }

  private getState(entityId: string): string {
    const entity = this.hass.states[entityId];
    return entity?.state ?? '';
  }

  private isState(entityId: string, state: string): boolean {
    return this.getState(entityId) === state;
  }

  private formatStatus(status: string): string {
    // Convert snake_case to Title Case
    if (!status || ['unknown', 'unavailable', 'none', ''].includes(status)) {
      return 'Idle';
    }
    const formatted = status.replace(/_/g, ' ').toLowerCase();
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  private buildStatusText(): string {
    const prefix = this.getEntityPrefix();

    // Get all relevant states
    const status = this.getState(`sensor.${prefix}_status`);
    const vacuumError = this.getState(`sensor.${prefix}_vacuum_error`);
    const dockError = this.getState(`sensor.${prefix}_dock_dock_error`);
    const isDrying = this.isState(
      `binary_sensor.${prefix}_dock_mop_drying`,
      'on',
    );
    const isCleaning = this.isState(`binary_sensor.${prefix}_cleaning`, 'on');
    const currentRoom = this.getState(`sensor.${prefix}_current_room`);
    const dryingSecsStr = this.getState(
      `sensor.${prefix}_dock_mop_drying_remaining_time`,
    );
    const dryingSecs = parseInt(dryingSecsStr, 10) || 0;

    // Check for vacuum error
    if (
      vacuumError &&
      !['none', 'unknown', 'unavailable', ''].includes(vacuumError)
    ) {
      return `Error: ${this.formatStatus(vacuumError)}`;
    }

    // Check for dock error
    if (
      dockError &&
      !['ok', 'none', 'unknown', 'unavailable', ''].includes(dockError)
    ) {
      return `Dock: ${this.formatStatus(dockError)}`;
    }

    // Check if mop is drying
    if (isDrying) {
      const totalMins = Math.ceil(dryingSecs / 60);
      const hours = Math.floor(totalMins / 60);
      const mins = totalMins % 60;

      let timeStr = '—';
      if (totalMins > 0) {
        if (hours > 0 && mins > 0) {
          timeStr = `${hours}h ${mins}m left`;
        } else if (hours > 0) {
          timeStr = `${hours}h left`;
        } else {
          timeStr = `${totalMins}m left`;
        }
      }
      return `Mop Drying · ${timeStr}`;
    }

    // Check if cleaning and show current room
    if (
      isCleaning &&
      currentRoom &&
      !['unknown', 'unavailable', 'none', ''].includes(currentRoom)
    ) {
      return `Cleaning ${currentRoom.toLowerCase()}`;
    }

    // Fall back to formatted status
    return this.formatStatus(status);
  }

  private renderStatus(): Template {
    if (!this.config.show_status) {
      return nothing;
    }

    const statusText = this.buildStatusText();

    return html`
      <div class="status">
        <span class="status-text" alt=${statusText}> ${statusText} </span>
        <ha-circular-progress
          .indeterminate=${this.requestInProgress}
          size="small"
        ></ha-circular-progress>
      </div>
    `;
  }

  private renderToolbar(state: VacuumEntityState): Template {
    if (!this.config.show_toolbar) {
      return nothing;
    }

    switch (state) {
      case 'on':
      case 'auto':
      case 'spot':
      case 'edge':
      case 'single_room':
      case 'cleaning': {
        return html`
          <div class="toolbar">
            <div
              class="toolbar-button"
              @click="${this.handleVacuumAction('pause')}"
            >
              <ha-icon-button>
                <ha-icon icon="hass:pause"></ha-icon>
              </ha-icon-button>
              <span class="toolbar-button-text"
                >${localize('common.pause')}</span
              >
            </div>
            <div
              class="toolbar-button"
              @click="${this.handleVacuumAction('return_to_base')}"
            >
              <ha-icon-button>
                <ha-icon icon="hass:home-map-marker"></ha-icon>
              </ha-icon-button>
              <span class="toolbar-button-text"
                >${localize('common.return_to_base')}</span
              >
            </div>
          </div>
        `;
      }

      case 'paused': {
        return html`
          <div class="toolbar">
            <div
              class="toolbar-button"
              @click="${this.handleVacuumAction('resume', {
                defaultService: 'start',
                request: true,
              })}"
            >
              <ha-icon-button>
                <ha-icon icon="hass:play"></ha-icon>
              </ha-icon-button>
              <span class="toolbar-button-text"
                >${localize('common.continue')}</span
              >
            </div>
            <div
              class="toolbar-button"
              @click="${this.handleVacuumAction('return_to_base')}"
            >
              <ha-icon-button>
                <ha-icon icon="hass:home-map-marker"></ha-icon>
              </ha-icon-button>
              <span class="toolbar-button-text"
                >${localize('common.return_to_base')}</span
              >
            </div>
          </div>
        `;
      }

      case 'returning':
      case 'docked':
      case 'idle':
      default: {
        const buttons = this.config.shortcuts.map(
          ({ name, service, icon, service_data, target }) => {
            const execute = () => {
              if (service) {
                return this.callService({ service, service_data, target });
              }
            };
            return html`
              <div class="toolbar-button" @click="${execute}">
                <ha-icon-button>
                  <ha-icon icon="${icon}"></ha-icon>
                </ha-icon-button>
                <span class="toolbar-button-text">${name}</span>
              </div>
            `;
          },
        );

        return html` <div class="toolbar">${buttons}</div> `;
      }
    }
  }

  private renderUnavailable(): Template {
    return html`
      <ha-card>
        <div class="preview not-available">
          <div class="metadata">
            <div class="not-available">
              ${localize('common.not_available')}
            </div>
          <div>
        </div>
      </ha-card>
    `;
  }

  protected render(): Template {
    if (!this.entity) {
      return this.renderUnavailable();
    }

    return html`
      <ha-card>
        <ha-ripple></ha-ripple>
        <div class="preview">
          <div class="header">
            <div class="tips">${this.renderBattery()}</div>
          </div>

          ${this.renderMapOrImage(this.entity.state)}

          <div class="metadata">
            ${this.renderName()} ${this.renderStatus()}
          </div>

          ${this.renderStats(this.entity.state)}
        </div>

        ${this.renderToolbar(this.entity.state)}
      </ha-card>
    `;
  }
}

declare global {
  interface Window {
    customCards?: unknown[];
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  preview: true,
  type: 'vacuum-card',
  name: localize('common.name'),
  description: localize('common.description'),
});
