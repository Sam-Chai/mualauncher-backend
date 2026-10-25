import java.nio.file.*;
public class BareProbe {
    public static void main(String[] args) throws Exception {
        if (System.getenv("DATABASE_WORKER_URL") != null || System.getenv("HOST_TEST_SECRET") != null)
            throw new IllegalStateException("Worker environment leaked");
        if (args[1].equals("timeout")) Thread.sleep(30000);
        if (args[1].equals("mutate")) Files.writeString(Path.of("input.txt"), "changed");
        if (args[1].equals("logs")) for (int i = 0; i < 100000; i++) System.out.print("x");
        Files.writeString(Path.of(args[0]), "OK");
    }
}
