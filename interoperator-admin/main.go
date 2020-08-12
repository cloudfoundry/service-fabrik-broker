package main

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/router"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/pkg/server"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"
)

func main() {
	ctrl.SetLogger(zap.New(zap.UseDevMode(true)))
	setupLog := ctrl.Log.WithName("setup")

	kubeConfig, err := ctrl.GetConfig()
	if err != nil {
		setupLog.Error(err, "Error while reading kubeconfig")
		os.Exit(1)
	}
	adminConfig := config.NewAdminConfig()

	adminConfig.InitConfig()

	serverParams := &server.Params{
		Port: adminConfig.ServerPort,
	}

	server := new(server.Server)
	server.Init(serverParams, router.GetAdminRouter(kubeConfig, adminConfig))

	setupLog.Info("Server starting to listen on port: ", "Port", serverParams.Port)

	go func() {
		err := server.Start()
		if err != nil {
			setupLog.Error(err, "Could not start server")
		}
	}()

	// listening OS shutdown singal
	signalChan := make(chan os.Signal, 1)
	signal.Notify(signalChan, syscall.SIGINT, syscall.SIGTERM)
	<-signalChan

	setupLog.Info("Got OS shutdown signal, shutting down server gracefully...")
	server.Stop()

}
