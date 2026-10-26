import java.nio.file.*;
import java.net.*;
import java.io.*;
import java.util.*;

/** Trusted acceptance fixture. Never accepts source code or commands from uploaded packs. */
public final class IsolationProbe {
    private static void require(boolean value) { if (!value) throw new IllegalStateException("Isolation invariant failed"); }
    private static void denied(String path) throws Exception {
        try { Files.writeString(Path.of(path), "probe", StandardOpenOption.CREATE, StandardOpenOption.APPEND); }
        catch (IOException expected) { return; }
        throw new IllegalStateException("Writable protected path: " + path);
    }
    public static void main(String[] args) throws Exception {
        String mode = args[0];
        switch (mode) {
            case "child":
                while (true) { Files.writeString(Path.of("child-alive"), "alive"); Thread.sleep(20); }
            case "boundaries":
                String status = Files.readString(Path.of("/proc/self/status"));
                require(status.matches("(?s).*Uid:\\s+65532\\s+65532\\s+65532\\s+65532.*"));
                require(status.matches("(?s).*CapEff:\\s+0+\\s.*"));
                require(status.matches("(?s).*NoNewPrivs:\\s+1\\s.*"));
                require(System.getenv().keySet().stream().noneMatch(k -> k.matches("(?i)(DATABASE_.*|OSS_.*|S3_.*|AWS_.*|SIGNING_.*|.*TOKEN.*|.*PASSWORD.*|.*SECRET.*|SSH_AUTH.*)")));
                require(!Files.exists(Path.of("/var/run/docker.sock")));
                denied("/input/probe.jar"); denied("/etc/passwd"); denied("/opt/unionlink/seal.mjs");
                try (Socket socket = new Socket()) {
                    try { socket.connect(new InetSocketAddress("1.1.1.1", 443), 1000); throw new IllegalStateException("Network available"); }
                    catch (IOException expected) { }
                }
                break;
            case "descendants":
                new ProcessBuilder("/opt/java/openjdk/bin/java", "-Xmx32m", "-XX:ActiveProcessorCount=1", "-cp", "/workspace/probe.jar", "IsolationProbe", "child").start();
                Thread.sleep(400); require(Files.exists(Path.of("child-alive"))); break;
            case "disk":
                byte[] chunk = new byte[1024 * 1024]; long size = 0; boolean limited = false;
                try (OutputStream out = Files.newOutputStream(Path.of("/tmp/fill"))) {
                    for (int i = 0; i < 80; i++) { out.write(chunk); size += chunk.length; }
                } catch (IOException expected) { limited = true; }
                require(limited && size <= 32L * 1024 * 1024); break;
            case "pids":
                int children = 0; boolean exhausted = false;
                try { for (; children < 100; children++) new ProcessBuilder("/bin/sleep", "60").start(); }
                catch (IOException expected) { exhausted = true; }
                require(exhausted && children < 48); break;
            case "symlink": Files.createSymbolicLink(Path.of("result.txt"), Path.of("/etc/passwd")); return;
            case "mutate": Files.writeString(Path.of("probe.jar"), "mutation", StandardOpenOption.APPEND); break;
            case "timeout": case "cancel": Thread.sleep(60000); break;
            case "memory":
                List<byte[]> blocks = new ArrayList<>();
                try { while (true) blocks.add(new byte[8 * 1024 * 1024]); }
                catch (OutOfMemoryError expected) { System.exit(72); } break;
            case "logs": for (int i = 0; i < 100000; i++) System.out.print("x"); break;
            default: throw new IllegalArgumentException("Unknown probe");
        }
        Files.writeString(Path.of("result.txt"), "OK");
    }
}
