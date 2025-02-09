// src/client.ts
import { EventEmitter } from "events";
import {
  elizaLogger as elizaLogger2,
  stringToUuid,
  getEmbeddingZeroVector
} from "@elizaos/core";

// src/environment.ts
import { z } from "zod";
var homeConfigSchema = z.object({
  SMARTTHINGS_TOKEN: z.string().min(1, "SmartThings token is required")
});
async function validateHomeConfig(runtime) {
  try {
    const config = {
      SMARTTHINGS_TOKEN: runtime.getSetting("SMARTTHINGS_TOKEN") || process.env.SMARTTHINGS_TOKEN
    };
    return homeConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new Error(`SmartThings configuration validation failed:
${errorMessages}`);
    }
    throw error;
  }
}

// src/capabilities.ts
var CapabilityManager = class {
  runtime;
  capabilities;
  constructor(runtime) {
    this.runtime = runtime;
    this.capabilities = /* @__PURE__ */ new Map();
    this.initializeCapabilities();
  }
  initializeCapabilities() {
    this.addCapability({
      interface: "Alexa.PowerController",
      version: "3",
      type: "AlexaInterface",
      properties: {
        supported: [{ name: "powerState" }],
        proactivelyReported: true,
        retrievable: true
      }
    });
    this.addCapability({
      interface: "Alexa.BrightnessController",
      version: "3",
      type: "AlexaInterface",
      properties: {
        supported: [{ name: "brightness" }],
        proactivelyReported: true,
        retrievable: true
      }
    });
  }
  addCapability(capability) {
    this.capabilities.set(capability.interface, capability);
  }
  getCapability(interfaceName) {
    return this.capabilities.get(interfaceName);
  }
  getAllCapabilities() {
    return Array.from(this.capabilities.values());
  }
};

// src/services/smart_things_api.ts
var SmartThingsApi = class {
  baseUrl = "https://api.smartthings.com/v1";
  token;
  constructor(runtime) {
    this.token = runtime.getSetting("SMARTTHINGS_TOKEN");
    if (!this.token) {
      throw new Error("SmartThings token is required");
    }
  }
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers
      }
    });
    if (!response.ok) {
      throw new Error(`SmartThings API error: ${response.statusText}`);
    }
    return response.json();
  }
  devices = {
    list: () => this.request("/devices"),
    get: (deviceId) => this.request(`/devices/${deviceId}`),
    getStatus: (deviceId) => this.request(`/devices/${deviceId}/status`),
    executeCommand: (deviceId, command) => this.request(`/devices/${deviceId}/commands`, {
      method: "POST",
      body: JSON.stringify({
        commands: [command]
      })
    }),
    executeCommands: (deviceId, commands) => this.request(`/devices/${deviceId}/commands`, {
      method: "POST",
      body: JSON.stringify({ commands })
    }),
    getComponents: (deviceId) => this.request(`/devices/${deviceId}/components`),
    getCapabilities: (deviceId) => this.request(`/devices/${deviceId}/capabilities`)
  };
  scenes = {
    list: () => this.request("/scenes"),
    execute: (sceneId) => this.request(`/scenes/${sceneId}/execute`, {
      method: "POST"
    })
  };
  rooms = {
    list: () => this.request("/rooms"),
    get: (roomId) => this.request(`/rooms/${roomId}`)
  };
};
var smartThingsApi = new SmartThingsApi(null);

// src/config.ts
var CAPABILITY_MAPPINGS = {
  switch: ["switch"],
  light: ["switch", "switchLevel", "colorControl", "colorTemperature"],
  thermostat: ["thermostat", "temperatureMeasurement", "humidityMeasurement"],
  lock: ["lock"],
  motionSensor: ["motionSensor"],
  contactSensor: ["contactSensor"],
  presenceSensor: ["presenceSensor"],
  mediaPlayer: ["mediaPlayback", "volume"],
  windowShade: ["windowShade"],
  garageDoor: ["garageDoor"],
  fan: ["fanSpeed", "switch"],
  powerMeter: ["powerMeter", "energyMeter"],
  battery: ["battery"]
};

// src/entities.ts
var EntityManager = class {
  runtime;
  api;
  entities;
  constructor(runtime) {
    this.runtime = runtime;
    this.api = new SmartThingsApi(runtime);
    this.entities = /* @__PURE__ */ new Map();
  }
  async discoverEntities() {
    try {
      const devices = await this.api.devices.list();
      for (const device of devices) {
        const entity = {
          entityId: device.deviceId,
          name: device.label || device.name,
          type: this.determineDeviceType(device.capabilities),
          capabilities: device.capabilities.map((cap) => cap.id),
          state: device.status
        };
        this.entities.set(entity.entityId, entity);
      }
    } catch (error) {
      throw new Error(`Entity discovery failed: ${error.message}`);
    }
  }
  determineDeviceType(capabilities) {
    for (const [type, requiredCaps] of Object.entries(CAPABILITY_MAPPINGS)) {
      if (requiredCaps.every(
        (cap) => capabilities.some((c) => c.id === cap)
      )) {
        return type;
      }
    }
    return "unknown";
  }
  getEntity(entityId) {
    return this.entities.get(entityId);
  }
  getAllEntities() {
    return Array.from(this.entities.values());
  }
  async updateEntityState(entityId, state) {
    const entity = this.entities.get(entityId);
    if (entity) {
      entity.state = state;
      this.entities.set(entityId, entity);
    }
  }
};

// src/state.ts
var StateManager = class {
  runtime;
  states;
  constructor(runtime) {
    this.runtime = runtime;
    this.states = /* @__PURE__ */ new Map();
  }
  async updateState(entityId, state) {
    this.states.set(entityId, state);
  }
  getState(entityId) {
    return this.states.get(entityId);
  }
  getAllStates() {
    return this.states;
  }
  getProvider() {
    return {
      name: "home-assistant-state",
      get: async () => {
        const states = Array.from(this.states.entries()).map(([entityId, state]) => `${entityId}: ${JSON.stringify(state)}`).join("\n");
        return `Current Home Assistant States:
${states}`;
      }
    };
  }
};

// src/smart_home.ts
import { elizaLogger } from "@elizaos/core";

// src/utils/command_parser.ts
var CommandParser = class {
  static COMMAND_PATTERNS = {
    turnOn: /turn on|switch on|enable/i,
    turnOff: /turn off|switch off|disable/i,
    setBrightness: /set brightness to (\d+)|dim to (\d+)|brighten to (\d+)/i,
    setTemperature: /set temperature to (\d+)|change temp to (\d+)/i,
    setColor: /change color to (\w+)|set color to (\w+)/i,
    lock: /lock|secure/i,
    unlock: /unlock|unsecure/i,
    open: /open|raise/i,
    close: /close|lower/i
  };
  static parseCommand(text) {
    for (const [action, pattern] of Object.entries(this.COMMAND_PATTERNS)) {
      const match = text.match(pattern);
      if (match) {
        const args = match.slice(1).find((arg) => arg !== void 0);
        return {
          command: action,
          args: args ? { value: args } : void 0
        };
      }
    }
    throw new Error("Unable to parse command");
  }
  static mapToDeviceCommand(command, args) {
    switch (command) {
      case "turnOn":
        return { capability: "switch", command: "on" };
      case "turnOff":
        return { capability: "switch", command: "off" };
      case "setBrightness":
        return {
          capability: "switchLevel",
          command: "setLevel",
          arguments: [parseInt(args.value)]
        };
      case "setTemperature":
        return {
          capability: "thermostat",
          command: "setTemperature",
          arguments: [parseInt(args.value)]
        };
      case "setColor":
        return {
          capability: "colorControl",
          command: "setColor",
          arguments: [{ hex: args.value }]
        };
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }
};

// src/templates.ts
var homeShouldRespondTemplate = `
# Task: Decide if the assistant should respond to home automation requests.

# Current home state:
{{homeState}}

# Recent message:
{{message}}

# Instructions: Determine if the assistant should respond to the message and control home devices.
Response options are [RESPOND], [IGNORE] and [STOP].

The assistant should:
- Respond with [RESPOND] to direct home automation requests (e.g., "turn on the lights")
- Respond with [RESPOND] to questions about device states (e.g., "are the lights on?")
- Respond with [IGNORE] to unrelated messages
- Respond with [STOP] if asked to stop controlling devices

Choose the option that best describes how the assistant should respond to the message:`;
var homeMessageHandlerTemplate = `
# Task: Generate a response for a home automation request.

# Current home state:
{{homeState}}

# User command:
{{command}}

# Command result:
{{result}}

# Instructions: Write a natural response that confirms the action taken and its result.
The response should be friendly and conversational while clearly indicating what was done.

Response:`;

// src/smart_home.ts
var SmartHomeManager = class {
  runtime;
  api;
  constructor(runtime) {
    this.runtime = runtime;
    this.api = new SmartThingsApi(runtime);
  }
  async handleCommand(command, userId) {
    try {
      const shouldRespond = await this.runtime.llm.shouldRespond(
        homeShouldRespondTemplate,
        command
      );
      if (shouldRespond !== "RESPOND") {
        return null;
      }
      const parsedCommand = CommandParser.parseCommand(command);
      const deviceCommand = CommandParser.mapToDeviceCommand(
        parsedCommand.command,
        parsedCommand.args
      );
      const result = await this.executeCommand(deviceCommand);
      const response = await this.runtime.llm.complete(
        homeMessageHandlerTemplate,
        {
          command,
          result,
          homeState: await this.getCurrentState()
        }
      );
      return {
        success: true,
        message: response,
        data: result
      };
    } catch (error) {
      elizaLogger.error("Error handling smart home command:", error);
      throw error;
    }
  }
  async getCurrentState() {
    try {
      const devices = await this.api.devices.list();
      return devices.map((device) => `${device.name}: ${JSON.stringify(device.status)}`).join("\n");
    } catch (error) {
      elizaLogger.error("Error getting current state:", error);
      return "Unable to fetch current state";
    }
  }
  async executeCommand(deviceCommand) {
    try {
      return await this.api.devices.executeCommand(
        deviceCommand.deviceId,
        {
          capability: deviceCommand.capability,
          command: deviceCommand.command,
          arguments: deviceCommand.arguments
        }
      );
    } catch (error) {
      elizaLogger.error("Error executing smart home command:", error);
      throw error;
    }
  }
};

// src/providers/device_state.ts
var deviceStateProvider = {
  get: async (runtime) => {
    const entityManager = new EntityManager(runtime);
    await entityManager.discoverEntities();
    const entities = entityManager.getAllEntities();
    const deviceStates = entities.map((entity) => `${entity.name}: ${entity.state}`).join("\n");
    return `Current Device States:
${deviceStates}`;
  }
};
var device_state_default = deviceStateProvider;

// src/actions/control_device.ts
var controlDeviceAction = {
  name: "CONTROL_DEVICE",
  similes: ["DEVICE_CONTROL", "SMART_HOME_CONTROL", "HOME_CONTROL"],
  description: "Controls smart home devices with specific commands",
  validate: async (runtime, message) => {
    const keywords = [
      "turn on",
      "turn off",
      "switch",
      "toggle",
      "set",
      "change",
      "adjust",
      "dim",
      "brighten",
      "lock",
      "unlock"
    ];
    return keywords.some(
      (keyword) => message.content.text.toLowerCase().includes(keyword)
    );
  },
  handler: async (runtime, message, state, options, callback) => {
    const smartHomeManager = new SmartHomeManager(runtime);
    const result = await smartHomeManager.handleCommand(message.content.text, message.userId);
    const response = {
      text: `Command executed: ${result.message || "Success"}`,
      action: "DEVICE_CONTROL_RESPONSE",
      source: "home-assistant"
    };
    await callback(response);
    return response;
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Turn on the living room lights"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "I'll turn on the living room lights for you",
          action: "CONTROL_DEVICE"
        }
      }
    ]
  ]
};
var control_device_default = controlDeviceAction;

// src/actions/discover_devices.ts
var discoverDevicesAction = {
  name: "DISCOVER_DEVICES",
  similes: ["SCAN_DEVICES", "FIND_DEVICES", "LIST_DEVICES"],
  description: "Discovers and lists all available smart home devices",
  validate: async (runtime, message) => {
    const keywords = [
      "discover",
      "find",
      "scan",
      "list",
      "show",
      "what",
      "devices",
      "lights",
      "switches"
    ];
    return keywords.some(
      (keyword) => message.content.text.toLowerCase().includes(keyword)
    );
  },
  handler: async (runtime, message, state, options, callback) => {
    const entityManager = new EntityManager(runtime);
    await entityManager.discoverEntities();
    const entities = entityManager.getAllEntities();
    const deviceList = entities.map((entity) => `- ${entity.name} (${entity.entityId}): ${entity.state}`).join("\n");
    const response = {
      text: `Here are all the available devices:

${deviceList}`,
      action: "DEVICE_LIST_RESPONSE",
      source: "home-assistant"
    };
    await callback(response);
    return response;
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "What devices do you see?"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Let me check what devices are available...",
          action: "DISCOVER_DEVICES"
        }
      }
    ]
  ]
};
var discover_devices_default = discoverDevicesAction;

// src/providers/automation_state.ts
var automationStateProvider = {
  name: "automation-state",
  get: async (runtime) => {
    try {
      const response = await fetch(
        `${runtime.getSetting("HOME_ASSISTANT_URL")}/api/states`,
        {
          headers: {
            Authorization: `Bearer ${runtime.getSetting("HOME_ASSISTANT_TOKEN")}`,
            "Content-Type": "application/json"
          }
        }
      );
      if (!response.ok) {
        throw new Error("Failed to fetch automation states");
      }
      const states = await response.json();
      const automations = states.filter((state) => state.entity_id.startsWith("automation."));
      const automationStates = automations.map((automation) => `${automation.attributes.friendly_name}: ${automation.state}`).join("\n");
      return `Current Automation States:
${automationStates}`;
    } catch (error) {
      return "Unable to fetch automation states";
    }
  }
};
var automation_state_default = automationStateProvider;

// src/client.ts
var HomeClient = class extends EventEmitter {
  runtime;
  capabilityManager;
  entityManager;
  stateManager;
  smartHomeManager;
  constructor(runtime) {
    super();
    this.runtime = runtime;
    this.initialize();
  }
  async initialize() {
    try {
      const config = await validateHomeConfig(this.runtime);
      this.capabilityManager = new CapabilityManager(this.runtime);
      this.entityManager = new EntityManager(this.runtime);
      this.stateManager = new StateManager(this.runtime);
      this.smartHomeManager = new SmartHomeManager(this.runtime);
      this.runtime.providers.push(this.stateManager.getProvider());
      this.runtime.providers.push(device_state_default);
      this.runtime.providers.push(automation_state_default);
      this.registerActions();
      this.startStateMonitoring();
      elizaLogger2.success("Home Assistant client initialized successfully");
    } catch (error) {
      elizaLogger2.error("Failed to initialize Home Assistant client:", error);
      throw error;
    }
  }
  registerActions() {
    this.runtime.registerAction(control_device_default);
    this.runtime.registerAction(discover_devices_default);
  }
  startStateMonitoring() {
    setInterval(async () => {
      try {
        await this.entityManager.discoverEntities();
        elizaLogger2.debug("Updated device states");
      } catch (error) {
        elizaLogger2.error("Failed to update device states:", error);
      }
    }, 6e4);
  }
  async handleCommand(command, userId) {
    const roomId = stringToUuid(`home-${userId}`);
    const userIdUUID = stringToUuid(userId);
    const memory = {
      id: stringToUuid(`command-${Date.now()}`),
      userId: userIdUUID,
      agentId: this.runtime.agentId,
      roomId,
      content: {
        text: command,
        source: "home-assistant"
      },
      embedding: getEmbeddingZeroVector(),
      createdAt: Date.now()
    };
    await this.runtime.messageManager.createMemory(memory);
    return this.smartHomeManager.handleCommand(command, userId);
  }
  async stop() {
    elizaLogger2.warn("Home Assistant client does not support stopping yet");
  }
};
var HomeClientInterface = {
  name: "home",
  start: async (runtime) => new HomeClient(runtime)
};

// src/index.ts
var homePlugin = {
  name: "home",
  description: "Home Assistant client",
  clients: [HomeClientInterface]
};
var index_default = homePlugin;
export {
  index_default as default
};
//# sourceMappingURL=index.js.map