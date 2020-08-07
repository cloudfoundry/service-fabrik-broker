package server

import (
	"context"
	"fmt"
	"net/http"
)

// Server is abstraction for underlying http server
type Server struct {
	server       *http.Server
	serverParams *Params
}

// Params is used to specify various params for http server
type Params struct {
	Port int
}

// Init initializes the Server
func (s *Server) Init(params *Params, handler http.Handler) {
	s.server = &http.Server{
		Addr: fmt.Sprintf(":%v", params.Port),
	}
	if handler != nil {
		s.server.Handler = handler
	}
}

// Start the server
func (s *Server) Start() error {
	if err := s.server.ListenAndServe(); err != nil {
		return err
	}
	return nil
}

// Stop the server
func (s *Server) Stop() {
	s.server.Shutdown(context.Background())
}
