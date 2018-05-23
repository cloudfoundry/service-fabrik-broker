#include <stdlib.h>
#include <unistd.h>
#include <stdio.h>
#include <linux/limits.h>
#include <string.h>
#include <seccomp.h>   /* libseccomp */
#include <sys/prctl.h> /* prctl */

int show_usage(char *argv)
{
    printf("Usage: %s <command> <syscalls>\n\tcommand: command to be executed with command line arguments\n\tsyscalls: space separated list of syscalls\n", argv);
    return 0;
}

int main(int argc, char **argv)
{
    int iterator;
    if (argc < 2)
    {
        show_usage(argv[0]);
        return 0;
    }
    if (argc >= 3)
    {
        // ensure none of our children will ever be granted more priv
        // (via setuid, capabilities, ...)
        // No need to set PR_SET_NO_NEW_PRIVS, it is enabled by default
        // prctl(PR_SET_NO_NEW_PRIVS, 1);
        // ensure no escape is possible via ptrace
        prctl(PR_SET_DUMPABLE, 0);
        // Init the filter
        scmp_filter_ctx ctx;
        ctx = seccomp_init(SCMP_ACT_KILL); // default action: kill
        // setup basic whitelisting
        for (iterator = 2; iterator < argc; iterator++)
        {

            if (seccomp_rule_add(ctx, SCMP_ACT_ALLOW, seccomp_syscall_resolve_name(argv[iterator]), 0) != 0)
            {
                fprintf(stderr, "Could not add seccomp rule for syscall %s\n", argv[iterator]);
                return (EXIT_FAILURE);
            }
        }
        seccomp_load(ctx);
    }
    FILE *pipe_fp;
    /* Create one way pipe line with call to popen() */
    char path[PATH_MAX];
    if ((pipe_fp = popen(strcat(argv[1], " 2>&1"), "r")) == NULL)
    {
        perror("Error in popen");
        exit(EXIT_FAILURE);
    }
    // Get output from child's stdout/stderr
    /* Processing loop */
    while (fgets(path, PATH_MAX, pipe_fp) != NULL)
    {
        printf("%s", path);
    }
    /* Close the pipe */
    int close_status = pclose(pipe_fp);
    if (close_status != 0)
    {
        exit(EXIT_FAILURE);
    }
    exit(EXIT_SUCCESS);
}