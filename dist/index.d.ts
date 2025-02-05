import { EventEmitter } from 'events';
import { IAgentRuntime, Client } from '@elizaos/core';

declare const homeShouldRespondTemplate = "\n# Task: Decide if the assistant should respond to home automation requests.\n\n# Current home state:\n{{homeState}}\n\n# Recent message:\n{{message}}\n\n# Instructions: Determine if the assistant should respond to the message and control home devices.\nResponse options are [RESPOND], [IGNORE] and [STOP].\n\nThe assistant should:\n- Respond with [RESPOND] to direct home automation requests (e.g., \"turn on the lights\")\n- Respond with [RESPOND] to questions about device states (e.g., \"are the lights on?\")\n- Respond with [IGNORE] to unrelated messages\n- Respond with [STOP] if asked to stop controlling devices\n\nChoose the option that best describes how the assistant should respond to the message:";
declare const homeMessageHandlerTemplate = "\n# Task: Generate a response for a home automation request.\n\n# Current home state:\n{{homeState}}\n\n# User command:\n{{command}}\n\n# Command result:\n{{result}}\n\n# Instructions: Write a natural response that confirms the action taken and its result.\nThe response should be friendly and conversational while clearly indicating what was done.\n\nResponse:";

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
}
declare const HomeClientInterface: Client;
declare function startHome(runtime: IAgentRuntime): HomeClient;

export { HomeClient, HomeClientInterface, homeMessageHandlerTemplate, homeShouldRespondTemplate, startHome };
