import { EventEmitter } from 'events';
import { IAgentRuntime, Plugin } from '@elizaos/core';

declare class HomeClient extends EventEmitter {
    private runtime;
    private capabilityManager;
    private entityManager;
    private stateManager;
    private smartHomeManager;
    constructor(runtime: IAgentRuntime);
    private initialize;
    private registerActions;
    private startStateMonitoring;
    handleCommand(command: string, userId: string): Promise<any>;
    stop(): Promise<void>;
}
declare const homePlugin: Plugin;

export { HomeClient, homePlugin as default };
