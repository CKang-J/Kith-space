import net from "node:net";

export function isPortAvailable(port: number, host: "127.0.0.1" | "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    const finish = (available: boolean) => {
      server.removeAllListeners();
      resolve(available);
    };
    server.once("error", () => finish(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => finish(true)));
  });
}
