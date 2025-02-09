import { HomeClientInterface } from "./client";

const homePlugin = {
    name: "home",
    description: "Home Assistant client",
    clients: [HomeClientInterface],
};
export default homePlugin;
