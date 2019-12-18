package gotemplate

import (
	"bytes"
	"reflect"
	"testing"
)

func Test_gotemplateOutput_FileContent(t *testing.T) {
	type fields struct {
		content bytes.Buffer
	}
	type args struct {
		filename string
	}
	tests := []struct {
		name    string
		fields  fields
		args    args
		want    string
		wantErr bool
	}{
		{
			name: "should return fileContent",
			fields: fields{
				content: *bytes.NewBuffer([]byte("fileContent")),
			},
			args: args{
				filename: "main",
			},
			want:    "fileContent",
			wantErr: false,
		},
		{
			name: "should fail if file is not present",
			fields: fields{
				content: *bytes.NewBuffer([]byte("fileContent")),
			},
			args: args{
				filename: "file2",
			},
			want:    "",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &gotemplateOutput{
				content: tt.fields.content,
			}
			got, err := c.FileContent(tt.args.filename)
			if (err != nil) != tt.wantErr {
				t.Errorf("gotemplateOutput.FileContent() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("gotemplateOutput.FileContent() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_gotemplateOutput_ListFiles(t *testing.T) {
	type fields struct {
		content bytes.Buffer
	}
	tests := []struct {
		name    string
		fields  fields
		want    []string
		wantErr bool
	}{
		{
			name: "should return main as the only filename",
			fields: fields{
				content: *bytes.NewBuffer([]byte("fileContent")),
			},
			want:    []string{"main"},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &gotemplateOutput{
				content: tt.fields.content,
			}
			got, err := c.ListFiles()
			if (err != nil) != tt.wantErr {
				t.Errorf("gotemplateOutput.ListFiles() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("gotemplateOutput.ListFiles() = %v, want %v", got, tt.want)
			}
		})
	}
}
